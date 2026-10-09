import { spawn } from "node:child_process";
import { constants } from "node:os";

// 元のstatusLineのcommandを`sh -c`で起動し、stdinをそのまま渡す。stdoutとstderrは継承して変えずに返し、待つ時間に上限は足さない。
// 起動できなければundefined。signalで終わったときは128にsignalの番号を足す。
export function runOriginalCommand(
	command: string,
	input: Buffer,
): Promise<number | undefined> {
	return new Promise((resolve) => {
		let child: ReturnType<typeof spawn>;
		try {
			child = spawn("sh", ["-c", command], {
				stdio: ["pipe", "inherit", "inherit"],
			});
		} catch {
			return resolve(undefined);
		}
		child.once("error", () => resolve(undefined));
		child.once("exit", (code, signal) =>
			resolve(code ?? 128 + (signal ? constants.signals[signal] : 0)),
		);
		// commandがstdinを読まずに終わると書き込みはEPIPEになる。表示にも終了コードにも影響させない。
		child.stdin?.on("error", () => {});
		child.stdin?.end(input);
	});
}
