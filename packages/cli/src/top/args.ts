import { givenTwice, unexpectedArgument } from "../help.js";
import type { Theme } from "./color.js";

export type TopArgs = {
	once: boolean;
	json: boolean;
	ascii: boolean;
	theme: Theme;
};

const THEMES: readonly Theme[] = ["auto", "light", "dark", "ansi"];

// 受け付けない形（未知の引数、値の無い--theme、繰り返し）は、その理由。
export function parseTopArgs(args: readonly string[]): TopArgs | string {
	const seen = new Set<string>();
	let theme: Theme = "auto";
	for (let i = 0; i < args.length; i += 1) {
		const arg = args[i] as string;
		if (seen.has(arg)) return givenTwice(arg);
		seen.add(arg);
		if (arg === "--theme") {
			const value = args[i + 1];
			if (!THEMES.includes(value as Theme))
				return `"--theme" must be one of ${THEMES.join(", ")}`;
			theme = value as Theme;
			i += 1;
		} else if (arg !== "--once" && arg !== "--json" && arg !== "--ascii") {
			return unexpectedArgument(arg);
		}
	}
	return {
		once: seen.has("--once"),
		json: seen.has("--json"),
		ascii: seen.has("--ascii"),
		theme,
	};
}
