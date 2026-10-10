// hookのentry。18未満のNode.jsでも構文解析できるよう、ES5とCommonJSだけで書く（correlation.md「実行環境」）。
// 本体は組み込みのfetchを使うため、Node.js 18以上でだけ読み込む。
"use strict";

var major = Number(process.versions.node.split(".")[0]);

if (major >= 18) {
	require("./harnessforce-hook-main.cjs");
} else {
	process.stderr.write(
		"harnessforce: session registration skipped (unsupported node)\n"
	);
	// 利用者に届く表示。文言はagent-coreのUNSUPPORTED_NODE_WARNINGと同じ値で、testで一致を確かめる。
	process.stdout.write(
		JSON.stringify({
			systemMessage: "Harnessforceのhookには18以上のNode.jsが必要です",
		}) + "\n"
	);
}
