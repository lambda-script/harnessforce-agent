import { timingSafeEqual } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export type Callback = {
	code: string | undefined;
	state: string | undefined;
	error: string | undefined;
};
export type CompletionStatus =
	| "connected"
	| "denied"
	| "no_workspace"
	| "viewer"
	| "failed";
type Completion = {
	status: CompletionStatus;
	// connectedのときだけ付ける。
	workspaceId?: string;
};
export type Loopback = {
	redirectUri: string;
	// 時間内にcallbackが来なければundefined。
	callback: Promise<Callback | undefined>;
	// callbackの応答を、webの完了画面への303で閉じる。2回目以降は何もしない。
	finish: (completion: Completion) => void;
};

const HOST = "127.0.0.1";
const CALLBACK_PATH = "/callback";
const COMPLETION_PATH = "/cli/connected";

// code、state、error_description、Workspaceの名前は載せない（correlation.md「CLI」）。
function completionUrl(webOrigin: string, completion: Completion): string {
	const url = new URL(COMPLETION_PATH, webOrigin);
	url.searchParams.set("status", completion.status);
	if (completion.status === "connected" && completion.workspaceId)
		url.searchParams.set("workspace", completion.workspaceId);
	return url.href;
}

// 例: "//"や"http://["。request listenerの中で投げると、processごと落ちて待ち受けが消える。
function parseRequestUrl(target: string | undefined): URL | undefined {
	try {
		return new URL(target ?? "/", `http://${HOST}`);
	} catch {
		return undefined;
	}
}

// 比較の時間からstateを1文字ずつ推測させない。長さは固定で秘密ではないため、先に比べてよい。
function isSameState(received: string | null, expected: string): boolean {
	if (received === null) return false;
	const receivedBytes = Buffer.from(received, "utf8");
	const expectedBytes = Buffer.from(expected, "utf8");
	return (
		receivedBytes.length === expectedBytes.length &&
		timingSafeEqual(receivedBytes, expectedBytes)
	);
}

export async function startLoopback(options: {
	state: string;
	timeoutMs: number;
	port: number;
	// 完了画面を開くwebのorigin。
	webOrigin: string;
}): Promise<Loopback> {
	let settle: (callback: Callback | undefined) => void = () => {};
	const callback = new Promise<Callback | undefined>((resolve) => {
		settle = resolve;
	});
	let held: ServerResponse | undefined;
	const server = createServer((req, res) => {
		const url = parseRequestUrl(req.url);
		if (url === undefined) {
			res.writeHead(400).end();
			return;
		}
		// ブラウザが送る/favicon.icoなどはcallbackとして数えない。
		if (url.pathname !== CALLBACK_PATH) {
			res.writeHead(404).end();
			return;
		}
		// 最初のcallbackだけを数える。CLIが結果を決めるまで応答を保留する。
		if (isStopped) {
			res.writeHead(404).end();
			return;
		}
		// stateが一致しないrequestは他のprocessやWebページからでも送れるため、ログインを終わらせず、待ち受けを続けて本物のcallbackかtimeoutを待つ。
		if (!isSameState(url.searchParams.get("state"), options.state)) {
			res.writeHead(303, {
				location: completionUrl(options.webOrigin, { status: "failed" }),
				"cache-control": "no-store",
			});
			res.end();
			return;
		}
		held = res;
		stop({
			// 空のcodeは、codeが無い場合と同じに扱う。
			code: url.searchParams.get("code") || undefined,
			state: url.searchParams.get("state") ?? undefined,
			error: url.searchParams.get("error") ?? undefined,
		});
	});
	const timer = setTimeout(() => stop(undefined), options.timeoutMs);
	let isStopped = false;
	// callbackとtimeoutのどちらか先の1回だけ。新しい接続は受けず、保留した応答はfinishまで残す。
	function stop(received: Callback | undefined) {
		if (isStopped) return;
		isStopped = true;
		clearTimeout(timer);
		server.close();
		if (!held) server.closeAllConnections();
		settle(received);
	}
	function finish(completion: Completion) {
		const response = held;
		held = undefined;
		if (!response) return;
		response.writeHead(303, {
			location: completionUrl(options.webOrigin, completion),
			"cache-control": "no-store",
		});
		response.end(() => server.closeAllConnections());
	}
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		// portを確保できないときはここでrejectし、他のportへ黙って移らない（correlation.md「CLI」）。
		server.listen(options.port, HOST, resolve);
	}).catch((error: unknown) => {
		clearTimeout(timer);
		throw error;
	});
	const { port } = server.address() as AddressInfo;
	return {
		redirectUri: `http://${HOST}:${port}${CALLBACK_PATH}`,
		callback,
		finish,
	};
}
