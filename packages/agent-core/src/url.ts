// correlation.md「hook」の共通の規則のscheme。keyを平文で流さないため、http:はlocalの受信だけに許す。
// 接続先（`harnessforce init --url`、buildの既定値）とingestの送信先の両方に同じ規則を使う。
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

// 接続先のpathの後ろにpathを連結する。文字列で連結すると"//host"で始まるpathが別のhostになるため、URLで組み立てる。
export function underBase(base: URL, path: string): URL {
	const url = new URL(base.origin);
	// originだけのbaseのpathnameは"/"になるため、末尾の/を除いてから連結する。
	url.pathname = `${base.pathname.replace(/\/+$/, "")}/${path}`;
	return url;
}

// scheme、host、port、pathだけを残し、末尾の/を除いた文字列。userinfo、query、fragmentを記録や鍵に含めない。
export const withoutExtras = (url: URL) =>
	`${url.origin}${url.pathname.replace(/\/+$/, "")}`;
