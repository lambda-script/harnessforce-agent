/// <reference path="./raw.d.ts" />
// 正本はpluginのSKILL.md。buildでhookのbundleとCLIのbundleの両方へ同じ本文を埋め込み、実行時にfileを読まない。
import skill from "../../../plugins/harnessforce/skills/using-harnessforce/SKILL.md?raw";

// frontmatterを除いた本文。
export const usingHarnessforceBody = skill
	.replace(/^---\n[\s\S]*?\n---\n+/, "")
	.trimEnd();
