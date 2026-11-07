import { createHash, randomBytes } from "node:crypto";

export type LoginSecrets = {
	codeVerifier: string;
	codeChallenge: string;
	state: string;
};

// 32 byteの乱数は、base64urlで43文字（RFC 7636が求める43〜128文字の下限）になる。
const RANDOM_BYTES = 32;

export const codeChallenge = (codeVerifier: string) =>
	createHash("sha256").update(codeVerifier).digest("base64url");

// 実行ごとに推測できないcode verifierとstateを作る（correlation.md「CLI」の手順2）。
export function createLoginSecrets(): LoginSecrets {
	const codeVerifier = randomBytes(RANDOM_BYTES).toString("base64url");
	return {
		codeVerifier,
		codeChallenge: codeChallenge(codeVerifier),
		state: randomBytes(RANDOM_BYTES).toString("base64url"),
	};
}
