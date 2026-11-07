import {
	COLLECT_BUDGET_MS,
	collectConfig,
} from "@harnessforce/agent-core/config/collect";
import type { ConfigComponent } from "@harnessforce/agent-core/config/component";
import type { RunGit } from "@harnessforce/agent-core/process/git";
import type { Env } from "@harnessforce/agent-core/types";
import { resolveProjectRoot } from "@harnessforce/agent-core/vcs";

export type SnapshotDeps = {
	homeDir: string;
	managedDir: string;
	// processの環境変数ではなく、記録の基点と同じ規則で読んだ`CLAUDE_CONFIG_DIR`と`CLAUDE_CODE_PLUGIN_CACHE_DIR`。
	env: Env;
	now: () => number;
};

export type Collected =
	| { kind: "collected"; components: ConfigComponent[] }
	// 1,000件超過と組の重複は構成で決まる。1秒の超過は一過性で、次の実行で集め直す。
	| { kind: "fixed_failure" }
	| { kind: "timeout" };

// improvement-loop.md「MCP server」「適用」: 構成の収集と同じ手順。収集の開始はproject rootを求める前とする。
export async function collectAt(
	projectRoot: string,
	deps: SnapshotDeps,
	startedMs = deps.now(),
): Promise<Collected> {
	const result = await collectConfig({
		projectRoot,
		homeDir: deps.homeDir,
		managedDir: deps.managedDir,
		env: deps.env,
		isExpired: () => deps.now() - startedMs > COLLECT_BUDGET_MS,
	});
	if (result.kind === "collected") return result;
	return result.reason === "timeout"
		? { kind: "timeout" }
		: { kind: "fixed_failure" };
}

// sessionのcwdの`mcp_server`の識別子（重複を除く）。1秒を超えたらundefined（保存しない）。
export async function collectMcpServers(
	cwd: string,
	git: RunGit,
	deps: SnapshotDeps,
): Promise<string[] | undefined> {
	const startedMs = deps.now();
	const projectRoot = await resolveProjectRoot(cwd, git);
	const collected = await collectAt(projectRoot, deps, startedMs);
	if (collected.kind === "timeout") return undefined;
	if (collected.kind === "fixed_failure") return [];
	return [
		...new Set(
			collected.components
				.filter((c) => c.kind === "mcp_server")
				.map((c) => c.id),
		),
	];
}
