import { readFileSync } from "node:fs";

// `?raw`で読んだfileを文字列として埋め込むrolldownのplugin。vitestはvite標準の`?raw`で同じ結果を得る。
export const rawPlugin = () => ({
	name: "harnessforce-raw",
	load(id) {
		if (!id.endsWith("?raw")) return null;
		const file = id.slice(0, -"?raw".length);
		this.addWatchFile(file);
		return `export default ${JSON.stringify(readFileSync(file, "utf8"))};`;
	},
});
