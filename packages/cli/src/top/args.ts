import type { Theme } from "./color.js";

export type TopArgs = {
	once: boolean;
	json: boolean;
	ascii: boolean;
	theme: Theme;
};

export const TOP_USAGE =
	"Usage: harnessforce top [--once] [--json] [--ascii] [--theme <auto|light|dark|ansi>]\n";

const THEMES: readonly Theme[] = ["auto", "light", "dark", "ansi"];

// 受け付けない形（未知の引数、値の無い--theme、繰り返し）はundefined。
export function parseTopArgs(args: readonly string[]): TopArgs | undefined {
	const seen = new Set<string>();
	let theme: Theme = "auto";
	for (let i = 0; i < args.length; i += 1) {
		const arg = args[i] as string;
		if (seen.has(arg)) return undefined;
		seen.add(arg);
		if (arg === "--theme") {
			const value = args[i + 1];
			if (!THEMES.includes(value as Theme)) return undefined;
			theme = value as Theme;
			i += 1;
		} else if (arg !== "--once" && arg !== "--json" && arg !== "--ascii") {
			return undefined;
		}
	}
	return {
		once: seen.has("--once"),
		json: seen.has("--json"),
		ascii: seen.has("--ascii"),
		theme,
	};
}
