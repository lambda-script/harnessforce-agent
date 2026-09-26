import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

export type Callback = {
	code: string | undefined;
	state: string | undefined;
	error: string | undefined;
};
export type Loopback = {
	redirectUri: string;
	// 時間内にcallbackが来なければundefined。
	callback: Promise<Callback | undefined>;
};

const HOST = "127.0.0.1";
const CALLBACK_PATH = "/callback";
// 本文は固定の文言とし、code、state、error_descriptionを含めない（correlation.md「CLI」）。
const page = (message: string) =>
	`<!doctype html><html lang="ja"><meta charset="utf-8"><title>Harnessforce</title><p>${message}</p></html>`;
const SUCCESS_PAGE = page("ターミナルに戻ってください");
const FAILURE_PAGE = page(
	"ログインに失敗しました。ターミナルを確認してください",
);

export async function startLoopback(options: {
	state: string;
	timeoutMs: number;
}): Promise<Loopback> {
	let settle: (callback: Callback | undefined) => void = () => {};
	const callback = new Promise<Callback | undefined>((resolve) => {
		settle = resolve;
	});
	const server = createServer((req, res) => {
		const url = new URL(req.url ?? "/", `http://${HOST}`);
		// ブラウザが送る/favicon.icoなどはcallbackとして数えない。
		if (url.pathname !== CALLBACK_PATH) {
			res.writeHead(404).end();
			return;
		}
		const received: Callback = {
			code: url.searchParams.get("code") ?? undefined,
			state: url.searchParams.get("state") ?? undefined,
			error: url.searchParams.get("error") ?? undefined,
		};
		const isSuccess =
			!received.error &&
			received.code !== undefined &&
			received.state === options.state;
		res.writeHead(200, {
			"content-type": "text/html; charset=utf-8",
			"cache-control": "no-store",
		});
		res.end(isSuccess ? SUCCESS_PAGE : FAILURE_PAGE, () => stop(received));
	});
	const timer = setTimeout(() => stop(undefined), options.timeoutMs);
	let isStopped = false;
	// callbackとtimeoutのどちらか先の1回だけ。
	function stop(received: Callback | undefined) {
		if (isStopped) return;
		isStopped = true;
		clearTimeout(timer);
		server.close();
		server.closeAllConnections();
		settle(received);
	}
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, HOST, resolve);
	}).catch((error: unknown) => {
		clearTimeout(timer);
		throw error;
	});
	const { port } = server.address() as AddressInfo;
	return { redirectUri: `http://${HOST}:${port}${CALLBACK_PATH}`, callback };
}
