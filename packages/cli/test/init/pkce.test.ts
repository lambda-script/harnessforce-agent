import { describe, expect, it } from "vitest";
import { codeChallenge, createLoginSecrets } from "../../src/init/pkce.js";

describe("PKCE", () => {
	it("derives the S256 challenge of RFC 7636 appendix B", () =>
		expect(codeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
			"E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
		));

	it("creates a fresh 43-character verifier and state per login", () => {
		const first = createLoginSecrets();
		const second = createLoginSecrets();
		expect(first.codeVerifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(first.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(first.codeChallenge).toBe(codeChallenge(first.codeVerifier));
		expect(second.codeVerifier).not.toBe(first.codeVerifier);
		expect(second.state).not.toBe(first.state);
	});
});
