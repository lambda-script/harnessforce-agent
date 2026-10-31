import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it, onTestFinished } from "vitest";
import { startLoopback } from "../../src/init/loopback.js";

const STATE = "expected-state";

async function get(url: string) {
	const response = await fetch(url, { redirect: "manual" });
	return {
		status: response.status,
		location: response.headers.get("location"),
		contentType: response.headers.get("content-type"),
		cacheControl: response.headers.get("cache-control"),
		body: await response.text(),
	};
}

describe("loopback", () => {
	const WEB = "https://app.example.test";

	it("listens on 127.0.0.1 and holds the /callback response until finish", async () => {
		const loopback = await startLoopback({
			state: STATE,
			timeoutMs: 5000,
			port: 0,
			webOrigin: WEB,
		});
		expect(loopback.redirectUri).toMatch(
			/^http:\/\/127\.0\.0\.1:\d+\/callback$/,
		);
		const favicon = await get(
			loopback.redirectUri.replace("/callback", "/favicon.ico"),
		);
		expect(favicon.status).toBe(404);
		const pending = get(`${loopback.redirectUri}?code=c-1&state=${STATE}`);
		expect(await loopback.callback).toEqual({
			code: "c-1",
			state: STATE,
			error: undefined,
		});
		let isAnswered = false;
		void pending.then(() => {
			isAnswered = true;
		});
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(isAnswered).toBe(false);
		loopback.finish({ status: "connected", workspaceId: "ws1" });
		const page = await pending;
		expect(page).toMatchObject({
			status: 303,
			location: `${WEB}/cli/connected?status=connected&workspace=ws1`,
			cacheControl: "no-store",
			body: "",
		});
		// 最初のcallbackで待ち受けを閉じる。
		await expect(fetch(loopback.redirectUri)).rejects.toThrow();
	});

	it.each([
		["denied", `?error=access_denied&state=${STATE}&error_description=secret`],
		["failed", `?state=${STATE}`],
	] as const)(
		"redirects to the %s screen without the code, state or description",
		async (status, query) => {
			const loopback = await startLoopback({
				state: STATE,
				timeoutMs: 5000,
				port: 0,
				webOrigin: WEB,
			});
			const pending = get(`${loopback.redirectUri}${query}`);
			await loopback.callback;
			loopback.finish({ status, workspaceId: "ws1" });
			const page = await pending;
			// workspaceはconnectedのときだけ付ける。
			expect(page.location).toBe(`${WEB}/cli/connected?status=${status}`);
			expect(page.location).not.toMatch(/secret|c-1|state=/);
		},
	);

	// 他のprocessやWebページが先に送っても、本物のcallbackを受け取れる。
	it("keeps listening past a malformed request and callbacks without the expected state", async () => {
		const loopback = await startLoopback({
			state: STATE,
			timeoutMs: 5000,
			port: 0,
			webOrigin: WEB,
		});
		// request-targetが"//"になり、new URLでは解釈できない。
		const malformed = await get(
			loopback.redirectUri.replace("/callback", "//"),
		);
		expect(malformed.status).toBe(400);
		for (const query of [
			"?code=c-1&state=other",
			`?code=c-1&state=${STATE}x`,
			"?error=access_denied",
		]) {
			const forged = await get(`${loopback.redirectUri}${query}`);
			expect(forged.status).toBe(303);
			expect(forged.location).toBe(`${WEB}/cli/connected?status=failed`);
			expect(forged.cacheControl).toBe("no-store");
		}
		const pending = get(`${loopback.redirectUri}?code=c-2&state=${STATE}`);
		expect(await loopback.callback).toEqual({
			code: "c-2",
			state: STATE,
			error: undefined,
		});
		loopback.finish({ status: "connected", workspaceId: "ws1" });
		expect((await pending).location).toBe(
			`${WEB}/cli/connected?status=connected&workspace=ws1`,
		);
	});

	it("ignores a second finish", async () => {
		const loopback = await startLoopback({
			state: STATE,
			timeoutMs: 5000,
			port: 0,
			webOrigin: WEB,
		});
		const pending = get(`${loopback.redirectUri}?code=c-1&state=${STATE}`);
		await loopback.callback;
		loopback.finish({ status: "viewer" });
		loopback.finish({ status: "failed" });
		expect((await pending).location).toBe(`${WEB}/cli/connected?status=viewer`);
	});

	it("resolves undefined when no callback arrives in time and stops listening", async () => {
		const loopback = await startLoopback({
			state: STATE,
			timeoutMs: 50,
			port: 0,
			webOrigin: WEB,
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
			startLoopback({ state: STATE, timeoutMs: 5000, port, webOrigin: WEB }),
		).rejects.toThrow();
	});
});
