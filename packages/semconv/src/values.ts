// schemaの値の形（semantic-conventions.md「値の形」）を、TypeBoxに依存せずに表す。
// hookのbundleがschemaの実装を読み込まずに使えるよう、schemasから分けて置く。

// semantic-conventions.md「値の形」のtoken。Unicodeの`White_Space` propertyを持つ文字の一覧であり、JSの\sと違い
// U+0085を含みU+FEFFを含まない。u flagの有無に依らず同じに解釈されるよう、BMPの文字の範囲だけで書く。
const WHITE_SPACE =
	"\\t-\\r \\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000";
export const TOKEN_PATTERN = `^[^${WHITE_SPACE}]+$`;
const NO_WHITE_SPACE = new RegExp(TOKEN_PATTERN);

// Tokenと同じ制約を、schemaをcompileせずに確かめる。文字数はcode pointで数える。
export const isToken = (value: string, maxLength = 256): boolean => {
	const length = [...value].length;
	return length >= 1 && length <= maxLength && NO_WHITE_SPACE.test(value);
};

// semantic-conventions.md「値の形」のinstant。APIはoffsetの無い日時を受け付けない。format(date-time)だけでは
// 実装によりoffsetが任意になるため、patternでoffsetの範囲（hhは00〜23、mmは00〜59）と年（1677〜2262）も固定する。
// JSON Schemaはoffsetを引いた瞬間を比べられないため、境界の年の中の範囲はisInstantが確かめる。
const INSTANT_YEAR =
	"(?:1(?:6(?:7[7-9]|[89]\\d)|[7-9]\\d\\d)|2(?:[01]\\d\\d|2(?:[0-5]\\d|6[0-2])))";
export const INSTANT_PATTERN = `^${INSTANT_YEAR}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-](?:[01]\\d|2[0-3]):[0-5]\\d)$`;
// INSTANT_PATTERNを通った値から、各部分を取り出す。
const INSTANT_PARTS =
	/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(?:Z|([+-])(\d{2}):(\d{2}))$/;
const INSTANT = new RegExp(INSTANT_PATTERN);
// DateTime64(9)で表せる範囲（ClickHouse reference）。両端を含む。
const MIN_INSTANT_MS = Date.UTC(1677, 8, 21, 0, 12, 44);
const MAX_INSTANT_MS = Date.UTC(2262, 3, 11, 23, 47, 16);

// 暦に存在する日時で、offsetを引いた瞬間が範囲内かを確かめる。小数秒は9桁より下を切り捨てて比べる。
export function isInstant(value: string): boolean {
	const parts = INSTANT.test(value) ? INSTANT_PARTS.exec(value) : null;
	if (!parts) return false;
	const [, ...fields] = parts;
	const [year, month, day, hour, minute, second] = fields
		.slice(0, 6)
		.map(Number) as [number, number, number, number, number, number];
	const [fraction = "", sign, offsetHours = "0", offsetMinutes = "0"] =
		fields.slice(6);
	const localMs = Date.UTC(year, month - 1, day, hour, minute, second);
	const local = new Date(localMs);
	const existsInCalendar =
		local.getUTCFullYear() === year &&
		local.getUTCMonth() === month - 1 &&
		local.getUTCDate() === day &&
		local.getUTCHours() === hour &&
		local.getUTCMinutes() === minute &&
		local.getUTCSeconds() === second;
	if (!existsInCalendar) return false;
	const offsetMs =
		(sign === "-" ? -1 : 1) *
		(Number(offsetHours) * 60 + Number(offsetMinutes)) *
		60_000;
	const secondMs = localMs - offsetMs;
	const nanos = Number(fraction.slice(0, 9) || "0");
	const isAfterMax =
		secondMs > MAX_INSTANT_MS || (secondMs === MAX_INSTANT_MS && nanos > 0);
	return secondMs >= MIN_INSTANT_MS && !isAfterMax;
}
