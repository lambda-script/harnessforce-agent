import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
// 実行時と同じ規則を使う。buildのNode.js（.node-version）は型を除いてtsのsourceを読める。
import { parseAllowedUrl } from "@harnessforce/agent-core/url";

// environments.md「接続先」: 接続先を与えないbuildの既定値。npmと公開repositoryのmarketplaceで配るのはこのbuildだけである。
const DEFAULT_URL = "https://harnessforce.dev";

/**
 * environments.md「接続先」: 接続先は任意のbuildの入力とし、与えない（空文字を含む）buildはproductionを既定値とする。
 * 与えた値が許可されない形なら、既定値へ戻さず失敗させる。
 * @param {Readonly<Record<string, string | undefined>>} env
 */
export function buildConfigFrom(env) {
	const url = env.HARNESSFORCE_BUILD_URL || DEFAULT_URL;
	if (!parseAllowedUrl(url))
		throw new Error(
			"HARNESSFORCE_BUILD_URL must be the apps/web base URL (https:, or http: for localhost, 127.0.0.1 or [::1])",
		);
	return { url, isDefault: url === DEFAULT_URL };
}

if (process.argv[1] === fileURLToPath(import.meta.url))
	writeFileSync(
		new URL("../dist/build-config.json", import.meta.url),
		`${JSON.stringify(buildConfigFrom(process.env))}\n`,
	);
