// correlation.md「hook」の共通の規則のscheme。keyを平文で流さないため、http:はlocalの受信だけに許す。
// 接続先（`hf init --url`、buildの既定値）とingestの送信先の両方に同じ規則を使う。
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function parseAllowedUrl(value: string | undefined): URL | undefined {
	if (!value) return undefined;
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return undefined;
	}
	const isAllowed =
		url.protocol === "https:" ||
		(url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname));
	return isAllowed ? url : undefined;
}
