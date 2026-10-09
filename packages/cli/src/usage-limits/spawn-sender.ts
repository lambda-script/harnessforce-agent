import { spawn } from "node:child_process";

// 自身を切り離した子processで起動する。stdin、stdout、stderrを閉じ、親が終わっても残る。
// 継承したままだと、Claude CodeがstatusLineの出力の終わりを待って表示が固まる。
export function spawnUsageSender(payload: string): void {
	spawn(
		process.execPath,
		[
			...process.execArgv,
			...process.argv.slice(1, 2),
			"usage-limits",
			"send",
			payload,
		],
		{ detached: true, stdio: "ignore" },
	).unref();
}
