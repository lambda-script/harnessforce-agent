import assert from "node:assert/strict";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, vi } from "vitest";
import {
	extensionOf,
	fetchIcons,
	isWhiteOverall,
	parseArgs,
	parseSpec,
} from "../skills/diagram/scripts/fetch-icons.mjs";

const bytes = (text: string) => Buffer.from(text);

it("extensionOf accepts SVG after an XML declaration, comments and an SVG DOCTYPE", () => {
	assert.equal(
		extensionOf(bytes('<svg xmlns="http://www.w3.org/2000/svg"/>')),
		"svg",
	);
	assert.equal(
		extensionOf(
			bytes(
				'<?xml version="1.0"?>\n<!-- @license x -->\n<svg viewBox="0 0 1 1"></svg>',
			),
		),
		"svg",
	);
	assert.equal(
		extensionOf(
			bytes('<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x">\n<svg>'),
		),
		"svg",
	);
});

it("extensionOf rejects an HTML page even when it was served for a .svg URL", () => {
	assert.equal(
		extensionOf(bytes("<!DOCTYPE html><html><body><svg></svg></body></html>")),
		undefined,
	);
	assert.equal(
		extensionOf(bytes("<html><head><title>404</title></head></html>")),
		undefined,
	);
});

it("extensionOf recognizes PNG and WebP by their magic bytes", () => {
	assert.equal(
		extensionOf(
			Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]),
		),
		"png",
	);
	assert.equal(
		extensionOf(
			Buffer.concat([bytes("RIFF"), Buffer.alloc(4), bytes("WEBPVP8 ")]),
		),
		"webp",
	);
});

it("isWhiteOverall flags a mark that is white everywhere, in either quote style", () => {
	assert.equal(
		isWhiteOverall(
			bytes("<svg><path fill='#fff'/><path fill=\"white\"/></svg>"),
		),
		true,
	);
	assert.equal(
		isWhiteOverall(
			bytes('<svg><path fill="#fff"/><path fill="#f38020"/></svg>'),
		),
		false,
	);
	assert.equal(
		isWhiteOverall(
			bytes('<svg><path fill="none" stroke="currentColor"/></svg>'),
		),
		false,
	);
});

it("parseSpec splits name, slug and explicit URL", async () => {
	assert.equal(parseSpec("neon").name, "neon");
	assert.equal(parseSpec("workers:cloudflare-workers").name, "workers");
	const explicit = parseSpec("logo=https://example.com/a=b.svg");
	assert.equal(explicit.name, "logo");
	assert.deepEqual(await explicit.tries(), [
		["explicit", "https://example.com/a=b.svg"],
	]);
});

it("parseSpec takes a URL in any letter case as a URL, not as a path", async () => {
	assert.deepEqual(await parseSpec("logo=HTTPS://example.com/a.svg").tries(), [
		["explicit", "HTTPS://example.com/a.svg"],
	]);
});

it("fetchIcons fails name=<path> to a missing file with the path it tried", async () => {
	const root = mkdtempSync(join(tmpdir(), "fetch-icons-"));
	const errors = vi.spyOn(console, "error").mockImplementation(() => {});
	try {
		const failed = await fetchIcons(
			["gone=vendor/gone.svg"],
			join(root, "icons"),
			{ baseDir: root },
		);
		assert.deepEqual(failed, ["gone=vendor/gone.svg"]);
		const message = errors.mock.calls.map((call) => call.join(" ")).join("\n");
		assert.match(message, /ENOENT/);
		// Windows reports the path with backslashes.
		assert.match(message, /vendor[\\/]gone\.svg/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

it("fetchIcons reads name=<path> from a file relative to baseDir, so the .mmd renders from an empty cache", async () => {
	const root = mkdtempSync(join(tmpdir(), "fetch-icons-"));
	try {
		const logo =
			'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#f38020" d="M0 0h24v24H0z"/></svg>';
		mkdirSync(join(root, "docs", "vendor"), { recursive: true });
		writeFileSync(join(root, "docs", "vendor", "workers.svg"), logo);
		const icons = join(root, "icons");
		const failed = await fetchIcons(["workers=vendor/workers.svg"], icons, {
			baseDir: join(root, "docs"),
		});
		assert.deepEqual(failed, []);
		assert.equal(readFileSync(join(icons, "workers.svg"), "utf8"), logo);
		const entry = JSON.parse(
			readFileSync(join(icons, "manifest.json"), "utf8"),
		).workers;
		assert.equal(entry.source, "file");
		// render.mjs compares this with the spec written in the .mmd.
		assert.equal(entry.spec, "workers=vendor/workers.svg");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

it("parseArgs keeps the first spec when --icons-dir is not given", () => {
	assert.deepEqual(parseArgs(["vercel", "neon"]).specs, ["vercel", "neon"]);
	assert.deepEqual(parseArgs(["storybook"]).specs, ["storybook"]);
});

it("parseArgs takes the value after --icons-dir as the directory, not as a spec", () => {
	const args = parseArgs(["neon", "--icons-dir", "/tmp/icons", "vercel"]);
	assert.equal(args.dir, "/tmp/icons");
	assert.deepEqual(args.specs, ["neon", "vercel"]);
});
