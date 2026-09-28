// commandの途中の終端はこの値で抜け、表示と終了コードを1か所で決める。
class CommandStop {
	constructor(readonly text: string) {}
}

export const stopWith = (text: string): never => {
	throw new CommandStop(text);
};

export const isStop = (error: unknown) => error instanceof CommandStop;

// bodyの途中の終端を表示して1を返す。それ以外の例外は投げ直す。
export async function runUntilStop(
	body: () => Promise<number>,
	stderr: (text: string) => void,
): Promise<number> {
	try {
		return await body();
	} catch (error) {
		if (!(error instanceof CommandStop)) throw error;
		stderr(`${error.text}\n`);
		return 1;
	}
}
