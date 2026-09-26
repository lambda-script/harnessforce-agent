// semantic-conventions.md「repositoryの正規化」。<host>/<owner>/<name>の3 segmentにならないremote
// （local path、`file://`、GitLabのsubgroupなど）はundefinedを返す。
const SCHEME_URL = /^[a-z][a-z0-9+.-]*:\/\//i;
// scp形式（[user@]host:path）。"host://"は上のURLとして扱う。
const SCP_LIKE = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/)(.+)$/;
const HOST = /^[a-z0-9.-]+$/;
const SEGMENT = /^[A-Za-z0-9_.-]+$/;

function splitRemote(
	remote: string,
): { host: string; path: string } | undefined {
	if (SCHEME_URL.test(remote)) {
		// URL.canParseはNode.js 18.17以降にしか無く、Node.js 18のhookからも使うためtry/catchで判定する。
		let url: URL;
		try {
			url = new URL(remote);
		} catch {
			return undefined;
		}
		return url.protocol === "file:"
			? undefined
			: { host: url.hostname, path: url.pathname };
	}
	const scp = SCP_LIKE.exec(remote);
	return scp?.[1] && scp[2] ? { host: scp[1], path: scp[2] } : undefined;
}

export function normalizeRepository(remoteUrl: string): string | undefined {
	const location = splitRemote(remoteUrl.trim());
	if (!location) return undefined;
	const lowerHost = location.host.toLowerCase();
	const host = lowerHost === "ssh.github.com" ? "github.com" : lowerHost;
	const segments = location.path
		.replace(/\/+$/, "")
		.replace(/\.git$/, "")
		.replace(/^\/+/, "")
		.split("/");
	if (
		segments.length !== 2 ||
		!HOST.test(host) ||
		!segments.every((segment) => SEGMENT.test(segment))
	)
		return undefined;
	// GitHubはownerとnameの大文字と小文字を区別しない。
	const [owner, name] =
		host === "github.com"
			? segments.map((segment) => segment.toLowerCase())
			: segments;
	return `${host}/${owner}/${name}`;
}
