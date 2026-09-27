import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { onTestFinished } from "vitest";

export type Reply = { status: number; body?: unknown; delayMs?: number };

export type ReadApiRequest = { url: string; headers: IncomingHttpHeaders };

// apps/webのRead APIの代わり。`/issues/{identifier}`と`/issues?query=`だけを持つ。
export async function startReadApi(
	options: {
		issue?: (identifier: string) => Reply;
		list?: (query: string | null) => Reply;
		basePath?: string;
	} = {},
) {
	const requests: ReadApiRequest[] = [];
	const basePath = options.basePath ?? "";
	const server = createServer((req, res) => {
		requests.push({ url: req.url ?? "", headers: req.headers });
		const url = new URL(req.url ?? "/", "http://read-api.test");
		const prefix = `${basePath}/api/v1/issues`;
		const reply = (r: Reply) => {
			const send = () =>
				res
					.writeHead(r.status, { "content-type": "application/json" })
					.end(r.body === undefined ? undefined : JSON.stringify(r.body));
			if (r.delayMs) setTimeout(send, r.delayMs);
			else send();
		};
		if (req.method !== "GET") return reply({ status: 405 });
		if (url.pathname === prefix)
			return reply(
				options.list?.(url.searchParams.get("query")) ?? {
					status: 200,
					body: { data: [], next_cursor: null },
				},
			);
		if (url.pathname.startsWith(`${prefix}/`))
			return reply(
				options.issue?.(
					decodeURIComponent(url.pathname.slice(prefix.length + 1)),
				) ?? { status: 404, body: { code: "not_found", message: "" } },
			);
		reply({ status: 404 });
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	onTestFinished(() => {
		server.closeAllConnections();
		server.close();
	});
	const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}${basePath}`;
	return { base, requests };
}

export const issueBody = (
	identifier: string,
	title = `Title of ${identifier}`,
) => ({
	identifier,
	title,
});
