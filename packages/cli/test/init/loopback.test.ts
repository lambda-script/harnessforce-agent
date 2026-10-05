import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it, onTestFinished } from "vitest";
import { startLoopback } from "../../src/init/loopback.js";

const STATE = "expected-state";

async function get(url: string) {
	const response = await fetch(url);
	return {
		status: response.status,
		contentType: response.headers.get("content-type"),
		cacheControl: response.headers.get("cache-control"),
		body: await response.text(),
	};
}

describe("loopback", () => {
	it("listens on 127.0.0.1 and answers /callback with a fixed page", async () => {
		const loopback = await startLoopback({
			state: STATE,
			timeoutMs: 5000,
			port: 0,
		});
		expect(loopback.redirectUri).toMatch(
			/^http:\/\/127\.0\.0\.1:\d+\/callback$/,
		);
		const favicon = await get(
			loopback.redirectUri.replace("/callback", "/favicon.ico"),
		);
		expect(favicon.status).toBe(404);
		const page = await get(`${loopback.redirectUri}?code=c-1&state=${STATE}`);
		expect(page).toMatchObject({
			status: 200,
			cacheControl: "no-store",
			body: expect.stringContaining("ターミナルに戻ってください"),
		});
		expect(page.contentType).toMatch(/^text\/html\b/);
		expect(page.body).not.toContain("c-1");
		expect(page.body).not.toContain(STATE);
		expect(await loopback.callback).toEqual({
			code: "c-1",
			state: STATE,
			error: undefined,
		});
		// 最初のcallbackで待ち受けを閉じる。
		await expect(fetch(loopback.redirectUri)).rejects.toThrow();
	});

	it.each([
		[
			"an error",
			`?error=access_denied&state=${STATE}&error_description=secret`,
		],
		["a wrong state", "?code=c-1&state=other"],
		["no code", `?state=${STATE}`],
		["an empty code", `?code=&state=${STATE}`],
	])("shows the failure page for %s", async (_, query) => {
		const loopback = await startLoopback({
			state: STATE,
			timeoutMs: 5000,
			port: 0,
		});
		const page = await get(`${loopback.redirectUri}${query}`);
		expect(page.status).toBe(200);
		expect(page.body).toContain(
			"ログインに失敗しました。ターミナルを確認してください",
		);
		expect(page.body).not.toContain("secret");
		expect(page.body).not.toContain("c-1");
		await loopback.callback;
	});

	it("resolves undefined when no callback arrives in time and stops listening", async () => {
		const loopback = await startLoopback({
			state: STATE,
			timeoutMs: 50,
			port: 0,
		});
		expect(await loopback.callback).toBeUndefined();
		await expect(fetch(loopback.redirectUri)).rejects.toThrow();
	});

	it("rejects when the requested port is already in use", async () => {
		const occupied = createServer();
		await new Promise<void>((resolve) =>
			occupied.listen(0, "127.0.0.1", resolve),
		);
		const { port } = occupied.address() as AddressInfo;
		onTestFinished(() => {
			occupied.closeAllConnections();
			occupied.close();
		});
		// 他のportへ黙って移らない（correlation.md「CLI」）。
		await expect(
			startLoopback({ state: STATE, timeoutMs: 5000, port }),
		).rejects.toThrow();
	});
});
