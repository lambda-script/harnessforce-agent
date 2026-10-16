import {
	apiTokenAccount,
	type InitKeychain,
	type InitOpenOptions,
	ingestKeyAccount,
	ingestOriginAccount,
	type Keychain,
	type KeychainItem,
	urlOriginAccount,
	workspaceAccounts,
} from "./keychain.js";

// 1つの保存先。timeoutMsを超えた操作は失敗する（kernelのkeyringは待たないため使わない）。
export type CredentialStore = {
	get(account: string, timeoutMs: number): Promise<string | undefined>;
	set(account: string, secret: string, timeoutMs: number): Promise<void>;
	delete(account: string, timeoutMs: number): Promise<void>;
};

export type SecretServiceStore = CredentialStore & {
	list(timeoutMs: number): Promise<readonly KeychainItem[]>;
};

type Options = {
	kernel: CredentialStore;
	secretService: SecretServiceStore;
	unavailableHint: string;
};

// correlation.md「実行環境」: ロックされたSecret Serviceは解錠の確認を待ち、画面の無いsessionでは終わらない。
// 60秒は、画面のある端末で利用者が解錠の確認に答えられる時間。
const SECRET_SERVICE_TIMEOUT_MS = 60_000;
const WAITING_NOTICE_DELAY_MS = 2_000;
// Harnessforceはこのaccountを読まないため、放棄した書き込みが後で残っても害は無い。
const PROBE_ACCOUNT = "availability-probe";
const PROBE_VALUE = "harnessforce";

// correlation.md「CLI」の`harnessforce otel-headers`: ロックされたSecret Serviceで解錠の確認を出さず待たないための確認の上限と、
// 移す処理の全体の上限。
const MIGRATION_PROBE_TIMEOUT_MS = 200;
const MIGRATION_BUDGET_MS = 1_000;

type Location = "kernel" | "secret-service";

const succeeds = (operation: () => Promise<unknown>) =>
	operation().then(
		() => true,
		() => false,
	);

// `<workspace_id>:<kind>`のWorkspaceのid。
const workspaceOf = (account: string) =>
	account.slice(0, account.lastIndexOf(":"));

// correlation.md「実行環境」のLinuxの規則。kernelのkeyringを先に読み、Secret Serviceの各操作に上限時間を置く。
export function createLinuxKeychain(options: Options): Keychain {
	return build(options, SECRET_SERVICE_TIMEOUT_MS);
}

function build(options: Options, timeoutMs: number): Keychain {
	const { kernel, secretService } = options;
	// Workspaceごとの保存先。keyと送信先のoriginの組を、別の保存先の項目と混ぜない。
	const locations = new Map<
		string,
		Promise<{ location: Location; isKernelBroken: boolean }>
	>();
	const locate = (workspaceId: string) => {
		let located = locations.get(workspaceId);
		if (!located) {
			located = kernel.get(ingestKeyAccount(workspaceId), timeoutMs).then(
				(key) => ({
					location: key ? "kernel" : "secret-service",
					isKernelBroken: false,
				}),
				() => ({ location: "secret-service", isKernelBroken: true }),
			);
			locations.set(workspaceId, located);
		}
		return located;
	};
	const storeAt = (location: Location) =>
		location === "kernel" ? kernel : secretService;

	return {
		unavailableHint: options.unavailableHint,
		async isAvailable() {
			return (
				(await succeeds(() => kernel.get(PROBE_ACCOUNT, timeoutMs))) ||
				(await succeeds(() => secretService.get(PROBE_ACCOUNT, timeoutMs)))
			);
		},
		async get(account) {
			const { location, isKernelBroken } = await locate(workspaceOf(account));
			if (location === "kernel") return kernel.get(account, timeoutMs);
			try {
				return await secretService.get(account, timeoutMs);
			} catch (error) {
				// 両方の保存先の操作が失敗した場合だけを読み出しの失敗とする。
				if (isKernelBroken) throw error;
				return undefined;
			}
		},
		async set(account, secret) {
			const { location } = await locate(workspaceOf(account));
			await storeAt(location).set(account, secret, timeoutMs);
		},
		async delete(account) {
			const { location } = await locate(workspaceOf(account));
			await storeAt(location).delete(account, timeoutMs);
		},
		async migrateFromKernel(workspaceId) {
			const { location } = await locate(workspaceId);
			if (location !== "kernel") return;
			await migrate(options, workspaceId).catch(() => {});
		},
		withTimeout: (ms) => build(options, ms),
		openForInit: (init) => openForInit(options, timeoutMs, init),
	};
}

// correlation.md「実行環境」の`harnessforce init`の保存先。読み出しだけを確かめると、
// ロックされたSecret Serviceで手順1を通り、発行の後の書き込みで止まるため、書いて消せるかを確かめる。
async function openForInit(
	{ kernel, secretService }: Options,
	timeoutMs: number,
	{ previousWorkspaceId, onWaiting }: InitOpenOptions,
): Promise<InitKeychain | undefined> {
	const canWrite = (store: CredentialStore) =>
		succeeds(async () => {
			await store.set(PROBE_ACCOUNT, PROBE_VALUE, timeoutMs);
			await store.delete(PROBE_ACCOUNT, timeoutMs);
		});
	const notice = setTimeout(onWaiting, WAITING_NOTICE_DELAY_MS);
	const usesSecretService = await canWrite(secretService).finally(() =>
		clearTimeout(notice),
	);
	// kernelのkeyringは項目を列挙できないため、前回のinitのWorkspaceの項目だけを読む。
	const readKernel = async () => {
		if (!previousWorkspaceId) return [];
		const accounts = [
			ingestKeyAccount(previousWorkspaceId),
			apiTokenAccount(previousWorkspaceId),
		];
		const items: KeychainItem[] = [];
		for (const account of accounts) {
			const secret = await kernel.get(account, timeoutMs);
			if (secret !== undefined) items.push({ account, secret });
		}
		return items;
	};

	if (usesSecretService)
		return {
			isKernelKeyring: false,
			items: [
				...(await secretService.list(timeoutMs)),
				// kernelのkeyringのsystem callを禁じた環境では、kernelのkeyringに項目は作られえないため、無いものとする。
				...(await readKernel().catch(() => [])),
			],
			set: (account, secret) => secretService.set(account, secret, timeoutMs),
			delete: (account) => secretService.delete(account, timeoutMs),
			async deleteElsewhere(workspaceId) {
				for (const account of workspaceAccounts(workspaceId))
					await kernel.delete(account, timeoutMs).catch(() => {});
			},
		};
	if (!(await canWrite(kernel))) return undefined;
	return {
		isKernelKeyring: true,
		items: await readKernel(),
		set: (account, secret) => kernel.set(account, secret, timeoutMs),
		delete: (account) => kernel.delete(account, timeoutMs),
		// Secret Serviceは確かめる操作で使えなかったため、そこにある項目は消さない。
		deleteElsewhere: async () => {},
	};
}

class MigrationExpired extends Error {}

// keyを最後に書くため、途中で止まってもSecret Serviceにkeyとoriginの組が欠けた項目を残さない。
// 値はkernelのkeyringにある同じ組であり、initの手順5の順（前の接続先のoriginと新しいkeyを組ませない）の理由は当たらない。
const MIGRATION_ORDER = (workspaceId: string) => [
	ingestOriginAccount(workspaceId),
	urlOriginAccount(workspaceId),
	apiTokenAccount(workspaceId),
	ingestKeyAccount(workspaceId),
];

async function migrate(
	{ kernel, secretService }: Options,
	workspaceId: string,
): Promise<void> {
	let isExpired = false;
	const deadline = Date.now() + MIGRATION_BUDGET_MS;
	const remaining = () => {
		if (isExpired) throw new MigrationExpired();
		return Math.max(deadline - Date.now(), 1);
	};
	const written: string[] = [];
	// Secret Serviceの読み直しが一致した後は、Secret Serviceの項目を消さない。kernelの削除が途中で止まっても読める組を残す。
	let isVerified = false;
	const move = async () => {
		await secretService.get(PROBE_ACCOUNT, MIGRATION_PROBE_TIMEOUT_MS);
		const items: KeychainItem[] = [];
		for (const account of MIGRATION_ORDER(workspaceId)) {
			const secret = await kernel.get(account, remaining());
			if (secret !== undefined) items.push({ account, secret });
		}
		for (const account of workspaceAccounts(workspaceId))
			await secretService.delete(account, remaining());
		for (const { account, secret } of items) {
			await secretService.set(account, secret, remaining());
			written.push(account);
		}
		for (const { account, secret } of items)
			if ((await secretService.get(account, remaining())) !== secret)
				throw new Error("the Secret Service returned a different value");
		remaining();
		isVerified = true;
		// keyを先に消すと、以後の読み出しはSecret Serviceの揃った組を選ぶ（読み出しの順）。残った項目は使われない。
		for (const { account } of [...items].reverse())
			await kernel.delete(account, MIGRATION_BUDGET_MS);
	};
	let timer: NodeJS.Timeout | undefined;
	const expiry = new Promise<never>((_, reject) => {
		timer = setTimeout(() => {
			isExpired = true;
			reject(new MigrationExpired());
		}, MIGRATION_BUDGET_MS);
	});
	try {
		await Promise.race([move(), expiry]);
	} catch (error) {
		if (isVerified) throw error;
		for (const account of written)
			await secretService.delete(account, MIGRATION_BUDGET_MS).catch(() => {});
		throw error;
	} finally {
		clearTimeout(timer);
	}
}
