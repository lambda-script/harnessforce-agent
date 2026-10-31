import { spawn } from "node:child_process";
import { KEYCHAIN_SERVICE } from "./keychain.js";
import type { CredentialStore, SecretServiceStore } from "./linux-keychain.js";
import type {
	SecretServiceLock,
	SecretServiceOperation,
} from "./secret-service-lock.js";

type Options = {
	// 子processを起動するNode.jsの実行file。
	execPath: string;
	// @napi-rs/keyringのpath。解決できなければ操作の失敗とする。
	resolveKeyring: () => string;
	lock: SecretServiceLock;
};

// 子processで1つの操作を行う。秘密はstdinで受け取り、argvに載せない。
// 上限時間に達したら自分を止める。親processが先に終わっても、上限時間を過ぎて解錠の確認を待つprocessを残さない。
// findCredentialsAsyncは保存先を指定できない。initは直前にSecret Serviceへ書けることを確かめた後でだけ呼ぶ。
const CHILD_SCRIPT = `
const [op, service, account, timeoutMs, modulePath] = process.argv.slice(1);
setTimeout(() => process.kill(process.pid, "SIGKILL"), Number(timeoutMs));
const chunks = [];
process.stdin.on("data", (chunk) => chunks.push(chunk));
process.stdin.on("end", async () => {
	try {
		const keyring = require(modulePath);
		const options = { linux: { store: "secret-service" } };
		let result = null;
		if (op === "list") {
			result = await keyring.findCredentialsAsync(service);
		} else {
			const entry = new keyring.AsyncEntry(service, account, options);
			if (op === "get") result = (await entry.getPassword()) ?? null;
			if (op === "set") await entry.setPassword(Buffer.concat(chunks).toString("utf8"));
			if (op === "delete") await entry.deleteCredential();
		}
		process.stdout.write(JSON.stringify({ result }), () => process.exit(0));
	} catch {
		process.exit(1);
	}
});
`;

type Operation = "get" | "set" | "delete" | "list";

// napiの同期呼び出しは同じprocessの中では打ち切れず、worker threadやthread poolで待つと
// processの終了まで止まるため、Secret Serviceの操作は子processで行い、上限時間で止める。
export function createSecretServiceProcess({
	execPath,
	resolveKeyring,
	lock,
}: Options): SecretServiceStore {
	const run = (
		op: Operation,
		account: string,
		timeoutMs: number,
		input = "",
	): Promise<unknown> =>
		new Promise((resolve, reject) => {
			const child = spawn(
				execPath,
				[
					"-e",
					CHILD_SCRIPT,
					op,
					KEYCHAIN_SERVICE,
					account,
					String(timeoutMs),
					resolveKeyring(),
				],
				{ stdio: ["pipe", "pipe", "ignore"] },
			);
			const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
			const chunks: Buffer[] = [];
			child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
			child.on("error", reject);
			child.on("close", (code) => {
				clearTimeout(timer);
				if (code !== 0) return reject(new Error(`Secret Service ${op} failed`));
				try {
					resolve(
						(
							JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
								result: unknown;
							}
						).result,
					);
				} catch (error) {
					reject(error);
				}
			});
			child.stdin.on("error", () => {});
			child.stdin.end(input);
		});

	const operations = (
		perform: (
			op: SecretServiceOperation,
			account: string,
			timeoutMs: number,
			input?: string,
		) => Promise<unknown>,
	): CredentialStore => ({
		async get(account, timeoutMs) {
			const secret = await perform("get", account, timeoutMs);
			return typeof secret === "string" ? secret : undefined;
		},
		async set(account, secret, timeoutMs) {
			await perform("set", account, timeoutMs, secret);
		},
		async delete(account, timeoutMs) {
			await perform("delete", account, timeoutMs);
		},
	});
	// 解錠の確認が要る操作は始めずに失敗させる。確認を出した子processを上限時間で止めても、
	// 提供者には確認が残り、KWalletでは後の確認がその後ろで待ち続けるためである。
	const withoutPrompt = async (
		op: SecretServiceOperation,
		account: string,
		timeoutMs: number,
		input?: string,
	) => {
		const startedAt = Date.now();
		if (await lock.needsUnlock(op, account, timeoutMs))
			throw new Error("the Secret Service is locked");
		const remainingMs = timeoutMs - (Date.now() - startedAt);
		if (remainingMs <= 0) throw new Error("Secret Service timed out");
		return run(op, account, remainingMs, input);
	};

	return {
		...operations(run),
		withoutUnlockPrompt: () => operations(withoutPrompt),
		provider: (timeoutMs) => lock.provider(timeoutMs),
		async list(timeoutMs) {
			const found = (await run("list", "", timeoutMs)) as {
				account: string;
				password: string;
			}[];
			return found.map(({ account, password }) => ({
				account,
				secret: password,
			}));
		},
	};
}
