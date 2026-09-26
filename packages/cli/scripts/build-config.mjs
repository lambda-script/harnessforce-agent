import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// src/url.tsのparseAllowedUrlと同じ規則。buildはtsのsourceを実行できないため写し、testで一致を確かめる。
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function isAllowedUrl(value) {
	if (!value || !URL.canParse(value)) return false;
	const url = new URL(value);
	return (
		url.protocol === "https:" ||
		(url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname))
	);
}

/**
 * correlation.md「接続先」: 接続先はbuildの入力として与え、与えないbuildは失敗させる。既定値で補わない。
 * @param {Readonly<Record<string, string | undefined>>} env
 */
export function buildConfigFrom(env) {
	const url = env.HARNESSFORCE_BUILD_URL;
	if (!isAllowedUrl(url))
		throw new Error(
			"HARNESSFORCE_BUILD_URL must be the apps/web base URL (https:, or http: for localhost, 127.0.0.1 or [::1])",
		);
	return { url };
}

if (process.argv[1] === fileURLToPath(import.meta.url))
	writeFileSync(
		new URL("../dist/build-config.json", import.meta.url),
		`${JSON.stringify(buildConfigFrom(process.env))}\n`,
	);
