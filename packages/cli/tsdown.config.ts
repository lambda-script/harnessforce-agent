import { defineConfig } from "tsdown";

export default defineConfig({
	entry: { bin: "src/bin.ts" },
	format: "esm",
	platform: "node",
	// correlation.md「実行環境」: hookは端末のNode.js 18以上でhfを起動する。
	target: "node18",
	fixedExtension: false,
	// hfはcommandとしてだけ公開し、型を公開しない。
	dts: false,
	deps: {
		// native moduleはbundleできない。semconvは利用者が同じpackageを直接読むため共有する。
		neverBundle: ["@napi-rs/keyring", "@harnessforce/semconv"],
		// agent-coreはnpmへ公開しないsourceのpackageであり、利用者の環境では解決できない。
		alwaysBundle: [/^@harnessforce\/agent-core\//],
	},
});
