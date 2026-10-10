/// <reference path="./raw.d.ts" />
// 正本はpluginのSKILL.md。buildでhookのbundleとCLIのbundleの両方へ同じ本文を埋め込み、実行時にfileを読まない。
// biome-ignore lint/style/noRestrictedImports: SKILL.mdはpluginのskillの正本であり、同じfileを別のpackageへ複製しない。
import skill from "../../../plugins/harnessforce/skills/using-harnessforce/SKILL.md?raw";

// frontmatterを除いた本文。
// checkoutの改行（Windowsの CRLF）によらず、同じ本文にする。
export const usingHarnessforceBody = skill
	.replace(/\r\n/g, "\n")
	.replace(/^---\n[\s\S]*?\n---\n+/, "")
	.trimEnd();
