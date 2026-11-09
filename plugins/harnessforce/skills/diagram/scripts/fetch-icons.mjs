#!/usr/bin/env node
// Fetches official brand logos, unmodified, into an icons directory for diagram nodes: never recolored or redrawn,
// with Lucide line icons for concepts that have no brand (references/icons.md).
//
// Usage: node fetch-icons.mjs [--icons-dir <dir>] <spec>...
//   name              slug == name                 e.g. neon
//   name:slug         a different slug             e.g. workers:cloudflare-workers
//   name:lucide/icon  a Lucide line icon           e.g. queue:lucide/list-ordered
//   name=URL          an explicit file             e.g. orpc=https://orpc.unnoq.com/logo.svg
//   name=path         a file in the repository, relative to the .mmd (render.mjs) or the working directory
//   name:aws/<Service>, name:gcp/<Product>, name:azure/<Service>
//                     the provider's official icon e.g. fargate:aws/fargate (provider-icons.mjs)
// Sources tried in order: svgl (exact title match), devicon, gilbarbara/logos.
// Writes <icons-dir>/<name>.<svg|png|webp> and merges an entry into <icons-dir>/manifest.json. The default
// icons dir is ${XDG_CACHE_HOME:-~/.cache}/harnessforce-diagram/icons, outside any repository.
// Exits 1 when any spec fails or has an invalid name.
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	HEADERS,
	loadProviderPackages,
	normalize,
	providerOf,
	resolveProviderIcon,
} from "./provider-icons.mjs";

const NAME = /^[A-Za-z0-9_-]+$/;
// Bodies smaller than this are error pages or empty files, not logos.
const MIN_BYTES = 50;
const TIMEOUT_MS = 15_000;
// Lucide glyphs use currentColor; give them the diagram's ink so they show on a white tile.
const LUCIDE_INK = "#3d4660";

// A request that throws (DNS, refused connection, proxy, timeout) is told apart from an answer without a logo: when no
// icon site can be reached, another slug will not help either.
async function download(url) {
	let host;
	try {
		host = new URL(url).host;
	} catch {
		// A malformed name=URL is a missing logo, not a network problem.
		return {};
	}
	try {
		const response = await fetch(url, {
			headers: HEADERS,
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
		if (!response.ok) return {};
		const bytes = Buffer.from(await response.arrayBuffer());
		return bytes.length >= MIN_BYTES ? { bytes } : {};
	} catch (error) {
		return {
			unreachable: `${host} (${error.cause?.code ?? error.message})`,
		};
	}
}

// A package member that does not inflate, or a repository file (name=path) that cannot be read, fails its spec only,
// like a download that fails.
function readMember(read) {
	try {
		return { bytes: read() };
	} catch (error) {
		return { error: error.message };
	}
}

// Decides the type from the content only. An HTML page served for a missing /logo.svg must not pass as a logo.
export function extensionOf(bytes) {
	if (
		bytes
			.subarray(0, 8)
			.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
	)
		return "png";
	if (
		bytes.subarray(0, 4).toString() === "RIFF" &&
		bytes.subarray(8, 12).toString() === "WEBP"
	)
		return "webp";
	// Skip an XML declaration, comments and a DOCTYPE; the first element must be <svg>.
	const prolog =
		/^\s*(<\?xml[^>]*\?>\s*|<!--[\s\S]*?-->\s*|<!DOCTYPE\s+svg[^>]*>\s*)*/i;
	const text = bytes.subarray(0, 4096).toString("utf8");
	return /^<svg[\s>]/i.test(text.replace(prolog, "")) ? "svg" : undefined;
}

// A logo that is white overall disappears on a white tile. A white detail on a colored mark is fine.
export function isWhiteOverall(bytes) {
	const paints = [
		...bytes
			.toString("utf8")
			.matchAll(/(?:fill|stroke|stop-color)[=:]\s*["']?([#a-zA-Z][^"';\s>]*)/g),
	]
		.map((m) => m[1].toLowerCase())
		.filter(
			(p) =>
				!["none", "transparent", "currentcolor"].includes(p) &&
				!p.startsWith("url("),
		);
	const white = paints.filter((p) => /^(#fff(fff)?|white)$/.test(p));
	return white.length > 0 && white.length === paints.length;
}

// svgl's search is fuzzy, so only an exact normalized title counts; a loose hit would ship the wrong brand.
async function svglUrl(slug) {
	const queries = [...new Set([slug, slug.replace(/[-_.]+/g, " ").trim()])];
	const targets = new Set([normalize(slug)]);
	if (slug.length > 4 && slug.endsWith("js")) {
		queries.push(slug.slice(0, -2));
		targets.add(normalize(slug.slice(0, -2)));
	}
	for (const query of queries) {
		const { bytes: body } = await download(
			`https://api.svgl.app?search=${encodeURIComponent(query)}`,
		);
		if (!body) continue;
		let items;
		try {
			items = JSON.parse(body.toString("utf8"));
		} catch {
			continue;
		}
		const hit = Array.isArray(items)
			? items.find((item) => targets.has(normalize(item.title ?? "")))
			: undefined;
		if (!hit) continue;
		// Tiles are white in both themes, so the light variant is the one to use.
		return typeof hit.route === "string"
			? hit.route
			: (hit.route?.light ?? hit.route?.dark);
	}
	return undefined;
}

// Each candidate is [source, url] or, for a file already in memory, [source, url, read].
async function candidates(requested, loadPackages) {
	if (requested.startsWith("lucide/"))
		return [
			[
				"lucide",
				`https://cdn.jsdelivr.net/npm/lucide-static/icons/${requested.slice("lucide/".length)}.svg`,
			],
		];
	const provider = providerOf(requested);
	if (provider) {
		try {
			const icon = await resolveProviderIcon(
				provider.provider,
				provider.query,
				loadPackages,
			);
			return [[provider.provider, icon.url, icon.read]];
		} catch (error) {
			console.error(`${provider.provider.padEnd(4)} ${error.message}`);
			return [];
		}
	}
	// The Google Cloud mark is a brand logo on svgl, not an icon in Google's packages.
	const slug = ["gcp", "googlecloudplatform"].includes(normalize(requested))
		? "google-cloud"
		: requested;
	const svgl = await svglUrl(slug);
	return [
		...(svgl ? [["svgl", svgl]] : []),
		[
			"devicon",
			`https://raw.githubusercontent.com/devicons/devicon/master/icons/${slug}/${slug}-original.svg`,
		],
		[
			"gilbarbara",
			`https://cdn.jsdelivr.net/gh/gilbarbara/logos/logos/${slug}-icon.svg`,
		],
		[
			"gilbarbara",
			`https://cdn.jsdelivr.net/gh/gilbarbara/logos/logos/${slug}.svg`,
		],
	];
}

export function parseSpec(spec, baseDir = process.cwd()) {
	const eq = spec.indexOf("=");
	if (eq > 0) {
		const target = spec.slice(eq + 1);
		if (/^https?:\/\//i.test(target))
			return {
				name: spec.slice(0, eq),
				tries: async () => [["explicit", target]],
			};
		// The repository's own official logo files are read where they are, never copied into the cache by hand, so that
		// the .mmd renders the same from an empty cache.
		const path = resolve(baseDir, target);
		return {
			name: spec.slice(0, eq),
			tries: async () => [["file", path, () => readFileSync(path)]],
		};
	}
	const colon = spec.indexOf(":");
	if (colon > 0)
		return {
			name: spec.slice(0, colon),
			tries: (loadPackages) => candidates(spec.slice(colon + 1), loadPackages),
		};
	return {
		name: spec,
		tries: (loadPackages) =>
			candidates(spec.toLowerCase().replaceAll(" ", ""), loadPackages),
	};
}

// What the skill keeps between runs (logos, check renders) lives outside the repository.
export function diagramCacheDir() {
	const cacheHome = process.env.XDG_CACHE_HOME || join(homedir(), ".cache");
	return join(cacheHome, "harnessforce-diagram");
}

// Logos are not committed: they are fetched into a cache outside the repository and embedded at render time.
export function defaultIconsDir() {
	return join(diagramCacheDir(), "icons");
}

// Fetches each spec into dir and returns the specs that failed. Prints one line per spec. Tests pass loadPackages to
// read provider packages from fixtures instead of the network.
export async function fetchIcons(
	specs,
	dir,
	{ loadPackages = loadProviderPackages, baseDir = process.cwd() } = {},
) {
	mkdirSync(dir, { recursive: true });
	const manifestPath = join(dir, "manifest.json");
	const manifest = existsSync(manifestPath)
		? JSON.parse(readFileSync(manifestPath, "utf8"))
		: {};
	const failed = [];
	for (const spec of specs) {
		const { name, tries } = parseSpec(spec, baseDir);
		if (!NAME.test(name)) {
			// A spec such as lucide/git-pull-request has no name before the colon.
			const isUnnamed = name === spec && spec.includes("/");
			const suggestedName = spec
				.split("/")
				.pop()
				.replace(/[^A-Za-z0-9_-]/g, "-");
			const suggestion = isUnnamed
				? `. Write it as ${suggestedName}:${spec}`
				: "";
			console.error(
				`SKIP ${spec}: the name must match [A-Za-z0-9_-]+ (it becomes a file name)${suggestion}`,
			);
			failed.push(spec);
			continue;
		}
		let found;
		let readError;
		let downloads = 0;
		let unreachableCount = 0;
		const unreachable = new Set();
		for (const [source, url, read] of await tries(loadPackages)) {
			if (!read) downloads++;
			const member = read ? readMember(read) : await download(url);
			if (member.unreachable) {
				unreachableCount++;
				unreachable.add(member.unreachable);
			}
			readError ??=
				member.error &&
				(source === "file"
					? `cannot read ${url}: ${member.error}`
					: `the package member does not inflate (${url}: ${member.error})`);
			const { bytes } = member;
			const ext = bytes && extensionOf(bytes);
			if (ext) {
				found = { source, url, bytes, ext };
				break;
			}
		}
		if (!found) {
			const isOffline = downloads > 0 && unreachableCount === downloads;
			let reason =
				"no source has it. Try name:<other slug>, or name=<URL or repository path of the official file>";
			if (isOffline)
				reason = `cannot reach ${[...unreachable].join(", ")}. Check the network or proxy; another slug will not help`;
			if (readError) reason = readError;
			console.error(`FAIL ${name}: ${reason}`);
			failed.push(spec);
			continue;
		}
		let { bytes } = found;
		if (found.source === "lucide")
			bytes = Buffer.from(
				bytes
					.toString("utf8")
					.replaceAll('stroke="currentColor"', `stroke="${LUCIDE_INK}"`),
			);
		// render.mjs picks the first <name>.* it finds, so a re-fetch must not leave the old file behind.
		for (const old of readdirSync(dir).filter(
			(file) => file.startsWith(`${name}.`) && file !== "manifest.json",
		))
			rmSync(join(dir, old));
		const file = `${name}.${found.ext}`;
		writeFileSync(join(dir, file), bytes);
		const whiteOverall = isWhiteOverall(bytes);
		manifest[name] = {
			spec,
			source: found.source,
			url: found.url,
			file,
			...(whiteOverall ? { whiteFill: true } : {}),
		};
		const warning = whiteOverall
			? "  [white fill: check the SVG; never recolor it]"
			: "";
		console.log(
			`OK   ${name.padEnd(16)} ${found.source.padEnd(11)} ${String(bytes.length).padStart(7)}B .${found.ext}${warning}`,
		);
	}
	writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
	return failed;
}

export function parseArgs(argv) {
	const help = argv.includes("--help");
	const at = argv.indexOf("--icons-dir");
	if (at < 0)
		return {
			help,
			dir: defaultIconsDir(),
			specs: argv.filter((arg) => arg !== "--help"),
		};
	const specs = argv.filter(
		(arg, i) => arg !== "--help" && i !== at && i !== at + 1,
	);
	return { help, dir: argv[at + 1], specs };
}

async function main() {
	const { help, dir, specs } = parseArgs(process.argv.slice(2));
	if (help || !dir || dir.startsWith("--") || specs.length === 0) {
		(help ? console.log : console.error)(
			"usage: fetch-icons.mjs [--icons-dir <dir>] <name | name:slug | name:lucide/icon | name:aws/<x> | name:gcp/<x> | name:azure/<x> | name=URL | name=path>...\n" +
				`default icons dir: ${defaultIconsDir()}`,
		);
		process.exit(help ? 0 : 2);
	}
	const failed = await fetchIcons(specs, dir);
	process.exit(failed.length > 0 ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
