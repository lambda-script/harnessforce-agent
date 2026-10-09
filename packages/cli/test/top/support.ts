import { mkdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RunGit } from "@harnessforce/agent-core/process/git";
import { tempDir } from "@harnessforce/test-support/temp-dir";
import type { ColorDepth } from "../../src/top/color.js";
import type { TopIo } from "../../src/top/io.js";

export const NOW = Date.parse("2026-10-09T12:00:00Z");
const line = (value: unknown) => `${JSON.stringify(value)}\n`;
const iso = (offsetSec: number) =>
	new Date(NOW + offsetSec * 1000).toISOString();

// 本文にはSECRETを入れ、画面とJSONに出ないことを確かめる。
export function transcript(
	sessionId: string,
	lastOffsetSec: number,
	options: { failures?: number; usage?: boolean; branch?: string } = {},
): string {
	const toolUses = Array.from({ length: 3 }, (_, i) => ({
		type: "tool_use",
		id: `${sessionId}-t${i}`,
		name: "Bash",
		input: { command: "SECRET command", file_path: "/SECRET/path" },
	}));
	return (
		line({
			type: "user",
			sessionId,
			cwd: "/work/web",
			gitBranch: options.branch ?? "feature/ENG-42",
			promptId: `p-${sessionId}`,
			timestamp: iso(lastOffsetSec - 300),
			message: { role: "user", content: "SECRET prompt" },
		}) +
		line({
			type: "assistant",
			sessionId,
			cwd: "/work/web",
			timestamp: iso(lastOffsetSec - 20),
			message: {
				id: `m-${sessionId}`,
				model: "claude-opus-5-5",
				...(options.usage === false
					? {}
					: {
							usage: {
								input_tokens: 1200,
								output_tokens: 300,
								cache_read_input_tokens: 5000,
								cache_creation_input_tokens: 100,
							},
						}),
				content: [{ type: "text", text: "SECRET response" }, ...toolUses],
			},
		}) +
		line({
			type: "user",
			sessionId,
			timestamp: iso(lastOffsetSec),
			message: {
				role: "user",
				content: toolUses.map((use, i) => ({
					type: "tool_result",
					tool_use_id: use.id,
					is_error: i < (options.failures ?? 0),
					content: "SECRET output",
				})),
			},
		})
	);
}

// Codexのrollout。本文にはSECRETを入れ、画面とJSONに出ないことを確かめる。
export function codexRollout(
	sessionId: string,
	lastOffsetSec: number,
	options: { info?: boolean; branch?: string } = {},
): string {
	const call = (type: string, name?: string) =>
		line({
			timestamp: iso(lastOffsetSec - 60),
			type: "response_item",
			payload: {
				type,
				...(name ? { name } : {}),
				arguments: "SECRET args",
				call_id: `${sessionId}-${type}`,
			},
		});
	return (
		line({
			timestamp: iso(lastOffsetSec - 300),
			type: "session_meta",
			payload: {
				id: sessionId,
				cwd: "/work/web",
				git: { branch: options.branch ?? "feature/ENG-42" },
			},
		}) +
		line({
			timestamp: iso(lastOffsetSec - 290),
			type: "turn_context",
			payload: { turn_id: "t1", model: "gpt-5-codex", cwd: "/work/web" },
		}) +
		line({
			timestamp: iso(lastOffsetSec - 280),
			type: "event_msg",
			payload: { type: "user_message", message: "SECRET prompt" },
		}) +
		call("function_call", "shell_command") +
		call("function_call", "shell_command") +
		call("local_shell_call") +
		line({
			timestamp: iso(lastOffsetSec - 50),
			type: "event_msg",
			payload: {
				type: "exec_command_end",
				exit_code: 1,
				status: "failed",
				aggregated_output: "SECRET output",
			},
		}) +
		line({
			timestamp: iso(lastOffsetSec - 40),
			type: "future_type_without_meaning",
			payload: { text: "SECRET future" },
		}) +
		line({
			timestamp: iso(lastOffsetSec),
			type: "event_msg",
			payload: {
				type: "token_count",
				info:
					options.info === false
						? null
						: {
								total_token_usage: {
									input_tokens: 1000,
									cached_input_tokens: 700,
									cache_write_input_tokens: 50,
									output_tokens: 200,
									total_tokens: 1200,
								},
								last_token_usage: {
									input_tokens: 900,
									cached_input_tokens: 600,
									cache_write_input_tokens: 50,
									output_tokens: 80,
									total_tokens: 980,
								},
								model_context_window: 258400,
							},
				rate_limits: {},
			},
		})
	);
}

export function projects() {
	const base = tempDir("hf-top-home-");
	const projectsDir = join(base, ".claude", "projects", "-work-web");
	mkdirSync(projectsDir, { recursive: true });
	const write = (name: string, text: string) => {
		const path = join(projectsDir, `${name}.jsonl`);
		writeFileSync(path, text);
		const mtime = new Date(NOW);
		utimesSync(path, mtime, mtime);
		return path;
	};
	// `$HOME/.codex/sessions/YYYY/MM/DD/<name>`。
	const writeCodex = (name: string, text: string, day = "2026/10/09") => {
		const dir = join(base, ".codex", "sessions", day);
		mkdirSync(dir, { recursive: true });
		const path = join(dir, name);
		writeFileSync(path, text);
		const mtime = new Date(NOW);
		utimesSync(path, mtime, mtime);
		return path;
	};
	return { home: base, write, writeCodex };
}

export const gitWithRemote: RunGit = async (cwd, args) => {
	if (cwd !== "/work/web") return undefined;
	if (args[0] === "rev-parse") return "true";
	if (args[0] === "remote" && args.length === 1) return "origin";
	return "git@github.com:Acme/Web.git";
};

type FakeOptions = {
	isTty?: boolean;
	columns?: number;
	colorDepth?: ColorDepth;
	// OSC 11の問い合わせに返す応答。無ければ応答しない。
	oscAnswer?: string;
};

// 端末の代わり。書かれた文字、入力、timerを手で動かせる。
export function fakeTty(options: FakeOptions = {}) {
	const writes: string[] = [];
	const listeners = new Set<(chunk: string) => void>();
	const resizeListeners = new Set<() => void>();
	const exitListeners = new Set<() => void>();
	const timers: {
		cb: () => void;
		ms: number;
		repeat: boolean;
		active: boolean;
	}[] = [];
	let raw = false;
	let paused = true;
	const io: TopIo = {
		isTty: options.isTty ?? true,
		columns: options.columns ?? 100,
		colorDepth: options.colorDepth ?? 24,
		write: (text) => {
			writes.push(text);
			if (text.includes("\x1b]11;?") && options.oscAnswer !== undefined) {
				const answer = options.oscAnswer;
				queueMicrotask(() => {
					for (const cb of listeners) cb(answer);
				});
			}
		},
		onData: (cb) => {
			listeners.add(cb);
			return () => listeners.delete(cb);
		},
		setRawMode: (on) => {
			raw = on;
		},
		setPaused: (value) => {
			paused = value;
		},
		onResize: (cb) => {
			resizeListeners.add(cb);
			return () => resizeListeners.delete(cb);
		},
		onProcessExit: (cb) => {
			exitListeners.add(cb);
			return () => exitListeners.delete(cb);
		},
		setInterval: (cb, ms) => {
			const timer = { cb, ms, repeat: true, active: true };
			timers.push(timer);
			return () => {
				timer.active = false;
			};
		},
		setTimeout: (cb, ms) => {
			const timer = { cb, ms, repeat: false, active: true };
			timers.push(timer);
			return () => {
				timer.active = false;
			};
		},
	};
	return {
		io,
		writes,
		text: () => writes.join(""),
		key: (chunk: string) => {
			for (const cb of [...listeners]) cb(chunk);
		},
		resize: () => {
			for (const cb of [...resizeListeners]) cb();
		},
		processExit: () => {
			for (const cb of [...exitListeners]) cb();
		},
		// 指定のmsのtimerを1回進める。
		tick: (ms: number) => {
			for (const timer of timers.filter((t) => t.active && t.ms === ms)) {
				timer.cb();
				if (!timer.repeat) timer.active = false;
			}
		},
		activeTimers: () => timers.filter((t) => t.active).length,
		state: () => ({
			raw,
			paused,
			listeners: listeners.size,
			resizeListeners: resizeListeners.size,
			exitListeners: exitListeners.size,
		}),
	};
}
