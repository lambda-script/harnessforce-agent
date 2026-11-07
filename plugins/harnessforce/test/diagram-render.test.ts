import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, it } from "vitest";
import {
	alignImageNodes,
	diagramThemeCss,
	groupEdgeLabelCss,
	groupTitleCss,
	inlineIcons,
	liftTitleLogos,
	portableMarkdown,
	titleLogoCss,
	toDark,
} from "../skills/diagram/scripts/render.mjs";

const RENDER = fileURLToPath(
	new URL("../skills/diagram/scripts/render.mjs", import.meta.url),
);
const work = mkdtempSync(join(tmpdir(), "render-test-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));

function iconsDir() {
	const dir = mkdtempSync(join(work, "icons-"));
	writeFileSync(join(dir, "neon.svg"), "<svg/>");
	writeFileSync(join(dir, "logo.png"), Buffer.from([0x89, 0x50]));
	return dir;
}

function decodeTile(text: string, quote = '"') {
	const match = text.match(
		new RegExp(
			`img: ${quote}data:image/svg\\+xml;base64,([^${quote}]+)${quote}`,
		),
	);
	assert.ok(match, text);
	return Buffer.from(match[1] ?? "", "base64").toString("utf8");
}

it("inlineIcons replaces quoted icon:<spec> with a tile holding the file named before : or =", () => {
	const source = "a@{ img: \"icon:neon\" }\nb@{ img: 'icon:logo:lucide/box' }";
	const { text, missing } = inlineIcons(source, [
		mkdtempSync(join(work, "empty-")),
		iconsDir(),
	]);
	assert.deepEqual(missing, []);
	assert.match(
		decodeTile(text),
		/<svg x="8" y="13" width="44" height="34" preserveAspectRatio="xMidYMid meet"\/>/,
	);
	assert.match(
		decodeTile(text.split("\n")[1], "'"),
		/href="data:image\/png;base64,iVA="/,
	);
});

it("inlineIcons reports a bare spec whose cached logo was fetched under a fuller spec", () => {
	const dir = mkdtempSync(join(work, "fetched-as-"));
	writeFileSync(join(dir, "list.svg"), "<svg/>");
	writeFileSync(join(dir, "neon.svg"), "<svg/>");
	writeFileSync(join(dir, "old.svg"), "<svg/>");
	writeFileSync(
		join(dir, "manifest.json"),
		JSON.stringify({
			list: {
				spec: "list:lucide/list-checks",
				source: "lucide",
				url: "u",
				file: "list.svg",
			},
			neon: { spec: "neon", source: "svgl", url: "u", file: "neon.svg" },
			old: { source: "svgl", url: "u", file: "old.svg" },
		}),
	);
	const bare = inlineIcons(
		'a@{ img: "icon:list" }\nb@{ img: "icon:neon" }\nc@{ img: "icon:old" }',
		[dir],
	);
	// With an empty cache, `icon:list` would fetch a brand logo named list, or nothing.
	assert.deepEqual(bare.incomplete, [
		{ spec: "list", fetchedAs: "list:lucide/list-checks" },
	]);
	assert.deepEqual(
		inlineIcons('a@{ img: "icon:list:lucide/list-checks" }', [dir]).incomplete,
		[],
	);
});

it("inlineIcons treats a full spec as missing when its cached logo was fetched under another spec", () => {
	const dir = mkdtempSync(join(work, "other-spec-"));
	writeFileSync(join(dir, "workers.svg"), "<svg/>");
	writeFileSync(
		join(dir, "manifest.json"),
		JSON.stringify({
			workers: {
				spec: "workers:cloudflare-workers",
				source: "svgl",
				url: "u",
				file: "workers.svg",
			},
		}),
	);
	// The repository's own file must be read, not the logo another diagram left under the same name.
	const { missing } = inlineIcons(
		'a@{ img: "icon:workers=../vendor/workers.svg" }',
		[dir],
	);
	assert.deepEqual(missing, ["workers=../vendor/workers.svg"]);
	assert.deepEqual(
		inlineIcons('a@{ img: "icon:workers:cloudflare-workers" }', [dir]).missing,
		[],
	);
});

it("inlineIcons puts every logo on the same square tile, centered in the same box whatever its shape", () => {
	const dir = mkdtempSync(join(work, "shapes-"));
	writeFileSync(
		join(dir, "wide.svg"),
		'<?xml version="1.0"?>\n<svg width="256" height="116" viewBox="0 0 256 116"><path/></svg>',
	);
	writeFileSync(
		join(dir, "sized.svg"),
		'<svg xmlns="http://www.w3.org/2000/svg" width="64" height="32"><path/></svg>',
	);
	const tiles = ["wide", "sized"].map((name) =>
		decodeTile(inlineIcons(`a@{ img: "icon:${name}" }`, [dir]).text),
	);
	for (const tile of tiles) {
		assert.match(
			tile,
			/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="60" height="60" viewBox="0 0 60 60">/,
		);
		assert.match(tile, /<rect [^>]*rx="10" fill="#ffffff" stroke="#cbd5e1"/);
		assert.match(
			tile,
			/<svg [^>]*x="8" y="13" width="44" height="34" preserveAspectRatio="xMidYMid meet"/,
		);
		assert.doesNotMatch(tile, /<\?xml/);
	}
	assert.match(tiles[0] ?? "", /viewBox="0 0 256 116"/);
	assert.doesNotMatch(tiles[0] ?? "", /width="256"/);
	// A logo with only width and height keeps its drawing area as its viewBox.
	assert.match(tiles[1] ?? "", /viewBox="0 0 64 32"/);
});

it("inlineIcons finds the logo's root tag past comments and through quoted attribute values", () => {
	const dir = mkdtempSync(join(work, "root-"));
	writeFileSync(
		join(dir, "odd.svg"),
		"<!-- made with an <svg> tool -->\n<svg data-x='a>b' width='64' height='32'><path/></svg>",
	);
	writeFileSync(join(dir, "closed.svg"), '<svg viewBox="0 0 10 10"/>');
	const odd = decodeTile(inlineIcons('a@{ img: "icon:odd" }', [dir]).text);
	assert.match(
		odd,
		/<svg data-x='a>b' x="8" y="13" width="44" height="34" preserveAspectRatio="xMidYMid meet" viewBox="0 0 64 32"><path\/><\/svg><\/svg>$/,
	);
	assert.doesNotMatch(odd, /made with/);
	const closed = decodeTile(
		inlineIcons('a@{ img: "icon:closed" }', [dir]).text,
	);
	assert.match(closed, /viewBox="0 0 10 10"\/><\/svg>$/);
});

it("inlineIcons drops a logo's title and the space between its tags, and rounds its numbers to two decimals", () => {
	const dir = mkdtempSync(join(work, "compact-"));
	writeFileSync(
		join(dir, "aws.svg"),
		'<svg viewBox="0 0 80 80">\n  <title>Icon/64/Arch</title>\n  <path d="M28.7169966,43.6876756 L31.71,40.7"/>\n</svg>',
	);
	const logo = decodeTile(inlineIcons('a@{ img: "icon:aws" }', [dir]).text);
	assert.match(
		logo,
		/viewBox="0 0 80 80"><path d="M28\.72,43\.69 L31\.71,40\.7"\/><\/svg><\/svg>$/,
	);
});

it("inlineIcons keeps a logo's transforms at their own precision", () => {
	const dir = mkdtempSync(join(work, "transform-"));
	writeFileSync(
		join(dir, "t.svg"),
		'<svg viewBox="0 0 80 80"><g transform="matrix(0.0416667 0 0 0.0416667 1.12345 0)"/></svg>',
	);
	const logo = decodeTile(inlineIcons('a@{ img: "icon:t" }', [dir]).text);
	assert.ok(
		logo.includes('transform="matrix(0.0416667 0 0 0.0416667 1.12345 0)"'),
		logo,
	);
});

it("inlineIcons crops the 2-unit margin of 24-unit line icons, so they look as large as brand marks", () => {
	const dir = mkdtempSync(join(work, "line-"));
	writeFileSync(
		join(dir, "cli.svg"),
		'<svg viewBox="0 0 24 24" fill="none" stroke="#3d4660"><path/></svg>',
	);
	writeFileSync(
		join(dir, "mark.svg"),
		'<svg viewBox="0 0 24 24"><path fill="#000"/></svg>',
	);
	assert.match(
		decodeTile(inlineIcons('a@{ img: "icon:cli" }', [dir]).text),
		/viewBox="2 2 20 20"/,
	);
	assert.match(
		decodeTile(inlineIcons('a@{ img: "icon:mark" }', [dir]).text),
		/viewBox="0 0 24 24"/,
	);
});

it("inlineIcons draws an AWS service icon (spec aws/<name>) without the white tile, and other provider icons on it", () => {
	const dir = mkdtempSync(join(work, "aws-"));
	writeFileSync(
		join(dir, "fargate.svg"),
		'<svg width="80px" height="80px" viewBox="0 0 80 80"><path/></svg>',
	);
	const { text } = inlineIcons('a@{ img: "icon:fargate:aws/fargate" }', [dir]);
	const tile = decodeTile(text);
	assert.doesNotMatch(tile, /<rect/);
	writeFileSync(join(dir, "run.svg"), '<svg viewBox="0 0 24 24"><path/></svg>');
	assert.match(
		decodeTile(inlineIcons('a@{ img: "icon:run:gcp/cloud-run" }', [dir]).text),
		/<rect/,
	);
	assert.match(
		tile,
		/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="60" height="60" viewBox="0 0 60 60">/,
	);
	assert.match(
		tile,
		/<svg x="0" y="0" width="60" height="60" preserveAspectRatio="xMidYMid meet" viewBox="0 0 80 80">/,
	);
});

it("inlineIcons reports every missing spec once and leaves its placeholder", () => {
	const source =
		'a@{ img: "icon:gone" }\nb@{ img: "icon:gone" }\nc@{ img: "icon:other=https://x.test/o.svg" }';
	const { text, missing } = inlineIcons(source, [iconsDir()]);
	assert.deepEqual(missing, ["gone", "other=https://x.test/o.svg"]);
	assert.equal(text, source);
});

it("inlineIcons does not touch the word icon: outside a quoted value", () => {
	const source = "%% icon:neon is fetched by fetch-icons.mjs";
	assert.equal(inlineIcons(source, [iconsDir()]).text, source);
});

it("toDark switches the frontmatter theme and swaps each palette color once", () => {
	const source = [
		"---",
		"config:",
		"  theme: neutral",
		"---",
		"flowchart LR",
		"  linkStyle 0 stroke:#2563EB",
		"  linkStyle 1 stroke:#64748b",
		"  linkStyle 2 stroke:#94a3b8",
		"  style g fill:#123456",
	].join("\n");
	const dark = toDark(source);
	assert.match(dark, /^ {2}theme: dark$/m);
	assert.match(dark, /linkStyle 0 stroke:#60a5fa/);
	// #64748b becomes #94a3b8, which is itself a light color; it must not be swapped again.
	assert.match(dark, /linkStyle 1 stroke:#94a3b8/);
	assert.match(dark, /linkStyle 2 stroke:#64748b/);
	assert.match(dark, /fill:#123456/);
});

it("toDark swaps the red node fill and stroke", () => {
	const dark = toDark(
		"flowchart TD\n  classDef dead fill:#fef2f2,stroke:#f87171,stroke-width:1.5px",
	);
	assert.match(dark, /classDef dead fill:#2a1416,stroke:#b91c1c,/);
});

it("toDark swaps the failure and waiting edge colors", () => {
	const dark = toDark(
		"flowchart LR\n  linkStyle 0 stroke:#dc2626\n  linkStyle 1 stroke:#d97706",
	);
	assert.match(dark, /linkStyle 0 stroke:#f87171\n/);
	assert.match(dark, /linkStyle 1 stroke:#fbbf24$/);
});

it("diagramThemeCss returns the frontmatter themeCSS, which the config file passed to mermaid-cli would replace", () => {
	const css = diagramThemeCss(
		[
			"---",
			"config:",
			"  theme: neutral",
			'  themeCSS: ".grid .tick line { stroke: #cbd5e1; }"',
			"---",
			"gantt",
		].join("\n"),
	);
	assert.equal(css, ".grid .tick line { stroke: #cbd5e1; }");
	assert.equal(
		diagramThemeCss("---\nconfig:\n  themeCSS: '.a { b: c; }'\n---\ngantt"),
		".a { b: c; }",
	);
});

it("diagramThemeCss ignores a themeCSS outside the frontmatter and returns an empty string without one", () => {
	assert.equal(
		diagramThemeCss(
			'---\nconfig:\n  theme: neutral\n---\nflowchart LR\n  %% themeCSS: "x"',
		),
		"",
	);
	assert.equal(diagramThemeCss("flowchart LR\n  a --> b"), "");
});

it("groupEdgeLabelCss puts the label of an edge inside a filled group on that group's fill", () => {
	const css = groupEdgeLabelCss(
		[
			"flowchart LR",
			'  subgraph cf["Cloudflare"]',
			'    ingest@{ img: "icon:workers", label: "ingest" }',
			"    queues[Queues]",
			"    r2",
			"  end",
			"  agent -->|OTLP| ingest",
			"  ingest -->|enqueue| queues",
			"  ingest -->|store| r2",
			'  r2 ---|"◀ read"| queues',
			"  ingest -->|again| queues",
			"  style cf fill:#2a1f12,stroke:#b45309",
		].join("\n"),
	);
	for (const id of [
		"L_ingest_queues_0",
		"L_ingest_r2_0",
		"L_r2_queues_0",
		"L_ingest_queues_2",
	]) {
		for (const part of [".labelBkg", ".edgeLabel", ".edgeLabel p"]) {
			assert.ok(
				css.includes(
					`[data-id="${id}"] ${part} { background-color: #2a1f12; }`,
				),
				`${id} ${part}\n${css}`,
			);
		}
	}
	assert.ok(!css.includes("L_agent_ingest"), css);
});

it("groupEdgeLabelCss keeps nesting through a subgraph without an id", () => {
	const css = groupEdgeLabelCss(
		[
			"flowchart LR",
			"  subgraph cf[Cloudflare]",
			'    subgraph "Workers"',
			"      a[A]",
			"    end",
			"    b[B]",
			"  end",
			"  a -->|x| b",
			"  style cf fill:#fff7ed",
		].join("\n"),
	);
	assert.ok(
		css.includes(
			'[data-id="L_a_b_0"] .labelBkg { background-color: #fff7ed; }',
		),
		css,
	);
});

it("groupEdgeLabelCss takes the innermost filled group holding both ends, past an unfilled one", () => {
	const css = groupEdgeLabelCss(
		[
			"flowchart LR",
			"  subgraph aws[AWS]",
			'    subgraph edge[" "]',
			"      cf[CloudFront]",
			"      s3[S3]",
			"    end",
			"    subgraph vpc[VPC]",
			"      app[App]",
			"    end",
			"  end",
			"  subgraph other[Other]",
			"    x[X]",
			"  end",
			"  cf -->|/*| s3",
			"  cf -->|/api| app",
			"  app -->|out| x",
			"  style aws fill:#f8fafc",
			"  style edge fill:none,stroke:none",
			"  style vpc fill:#f0fdf4",
		].join("\n"),
	);
	assert.ok(
		css.includes(
			'[data-id="L_cf_s3_0"] .labelBkg { background-color: #f8fafc; }',
		),
		css,
	);
	assert.ok(
		css.includes(
			'[data-id="L_cf_app_0"] .labelBkg { background-color: #f8fafc; }',
		),
		css,
	);
	assert.ok(!css.includes("L_app_x"), css);
});

it("alignImageNodes gives every image node's label the wrapping width, so tiles in one column line up", () => {
	const source = [
		"---",
		"config:",
		"  flowchart:",
		"    wrappingWidth: 180",
		"---",
		"flowchart LR",
		'  a@{ img: "icon:neon", label: "<b>Neon</b>", pos: "b" }',
		"  b@{ label: 'X', img: 'icon:x' }",
		'  c@{ shape: rect, label: "plain" } --> e@{ img: "icon:neon", label: "E" }',
		"  d[text]",
	].join("\n");
	const lines = alignImageNodes(source).split("\n");
	assert.equal(
		lines[6],
		`  a@{ img: "icon:neon", label: "<span style='display:inline-block;min-width:180px'><b>Neon</b></span>", pos: "b" }`,
	);
	assert.equal(
		lines[7],
		`  b@{ label: '<span style="display:inline-block;min-width:180px">X</span>', img: 'icon:x' }`,
	);
	assert.equal(
		lines[8],
		`  c@{ shape: rect, label: "plain" } --> e@{ img: "icon:neon", label: "<span style='display:inline-block;min-width:180px'>E</span>" }`,
	);
	assert.equal(lines[9], source.split("\n")[9]);
});

it("alignImageNodes uses mermaid's default wrapping width of 200 px when the diagram sets none", () => {
	assert.match(
		alignImageNodes('flowchart LR\n  a@{ img: "icon:neon", label: "A" }'),
		/min-width:200px'>A</,
	);
});

function mergedDiagram(...nodes: string[]) {
	return [
		"---",
		"config:",
		"  elk:",
		"    mergeEdges: true",
		"---",
		"flowchart LR",
		...nodes,
	].join("\n");
}

function tileOf(node: string) {
	return inlineIcons(node, [iconsDir()]).text;
}

it("alignImageNodes pads each tile on the side away from its label when the diagram merges edges", () => {
	const below = tileOf(
		'  a@{ img: "icon:neon", label: "<b>A</b><br/><small>a</small>", pos: "b", w: 72, h: 72, constraint: "on" }',
	);
	const above = tileOf(
		'  b@{ img: "icon:neon", label: "B", pos: "t", w: 60, h: 60, constraint: "on" }',
	);
	const bare = tileOf(
		'  c@{ img: "icon:neon", label: "C<br>c", pos: t, h: 72 }',
	);
	const [a, b, c] = alignImageNodes(mergedDiagram(below, above, bare))
		.split("\n")
		.slice(6);
	assert.match(a, /min-width:200px'><b>A<\/b>/);
	// Two lines of 27 px, the 4 px label box padding and the 8 px gap: 66 px over a 72 px tile is 55 tile units.
	assert.match(a, /, h: 138, /);
	assert.match(
		decodeTile(a),
		/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="60" height="115" viewBox="0 -55 60 115">/,
	);
	// One line: 39 px over a 60 px tile, below the tile because the label is on top.
	assert.match(b, /, h: 99, /);
	assert.match(
		decodeTile(b),
		/^<svg [^>]*width="60" height="99" viewBox="0 0 60 99">/,
	);
	// YAML lets pos go unquoted, and <br> counts as a line break as <br/> does.
	assert.match(c, /, h: 138 }/);
	assert.match(decodeTile(c), /viewBox="0 0 60 115"/);
});

it("alignImageNodes leaves tiles and heights alone without merged edges, without h:, or for images it did not make", () => {
	const plain = tileOf(
		'  a@{ img: "icon:neon", label: "A", w: 72, h: 72, constraint: "on" }',
	);
	assert.match(alignImageNodes(`flowchart LR\n${plain}`), /, h: 72, /);
	const noHeight = tileOf('  a@{ img: "icon:neon", label: "A" }');
	assert.match(
		decodeTile(alignImageNodes(mergedDiagram(noHeight))),
		/height="60" viewBox="0 0 60 60"/,
	);
	const foreign = `  a@{ img: "data:image/svg+xml;base64,${Buffer.from("<svg/>").toString("base64")}", label: "A", h: 72 }`;
	assert.match(alignImageNodes(mergedDiagram(foreign)), /, h: 72 }/);
});

it.skipIf(process.platform === "win32")(
	"render.mjs --no-fetch names the missing icons, exits 1, and neither calls mermaid-cli nor writes a PNG",
	() => {
		const dir = mkdtempSync(join(work, "missing-"));
		const marker = join(dir, "mmdc-called");
		const stub = join(dir, "mmdc");
		writeFileSync(stub, `#!/bin/sh\ntouch "${marker}"\n`);
		chmodSync(stub, 0o755);
		const diagram = join(dir, "x.mmd");
		writeFileSync(
			diagram,
			'flowchart LR\n  a@{ img: "icon:gone", label: "a" }\n',
		);
		const out = join(dir, "out");

		const result = spawnSync(
			"node",
			[RENDER, diagram, "--icons-dir", iconsDir(), "--no-fetch", "--out", out],
			{
				encoding: "utf8",
				env: { ...process.env, MMDC: stub },
			},
		);

		assert.equal(result.status, 1);
		assert.match(result.stderr, /icons not found in .*: gone$/m);
		assert.equal(existsSync(marker), false);
		assert.equal(
			existsSync(out) && readdirSync(out).some((f) => f.endsWith(".png")),
			false,
		);
	},
);

it("render.mjs rejects an option without a value", () => {
	const result = spawnSync("node", [RENDER, "x.mmd", "--scale"], {
		encoding: "utf8",
	});
	assert.equal(result.status, 2);
	assert.match(result.stderr, /usage: render\.mjs/);
});

it.skipIf(process.platform === "win32")(
	"render.mjs runs mermaid-cli in UTC, so gantt times do not move with the renderer's time zone",
	() => {
		const dir = mkdtempSync(join(work, "tz-"));
		const stub = join(dir, "mmdc");
		writeFileSync(stub, '#!/bin/sh\n[ "$TZ" = "UTC" ]\n');
		chmodSync(stub, 0o755);
		const diagram = join(dir, "x.mmd");
		writeFileSync(
			diagram,
			"gantt\n  dateFormat YYYY-MM-DD HH:mm\n  a :a1, 2026-03-08 01:00, 2026-03-08 04:00\n",
		);
		const result = spawnSync(
			"node",
			[RENDER, diagram, "--no-fetch", "--theme", "light"],
			{
				encoding: "utf8",
				env: { ...process.env, MMDC: stub, TZ: "America/New_York" },
			},
		);
		assert.equal(result.status, 0, result.stderr);
	},
);

it.skipIf(process.platform === "win32")(
	"render.mjs asks mermaid-cli for each diagram at its natural width, not shrunk to fit 800 px",
	() => {
		const dir = mkdtempSync(join(work, "width-"));
		const stub = join(dir, "mmdc");
		writeFileSync(
			stub,
			[
				"#!/usr/bin/env node",
				'const { readFileSync } = require("node:fs");',
				'const config = JSON.parse(readFileSync(process.argv[process.argv.indexOf("-c") + 1], "utf8"));',
				'const types = ["flowchart", "sequence", "state", "er", "gantt"];',
				"process.exit(types.every((type) => config[type]?.useMaxWidth === false) ? 0 : 1);",
				"",
			].join("\n"),
		);
		chmodSync(stub, 0o755);
		const diagram = join(dir, "x.mmd");
		writeFileSync(diagram, "sequenceDiagram\n  a->>b: hi\n");
		const result = spawnSync(
			"node",
			[RENDER, diagram, "--no-fetch", "--theme", "light"],
			{
				encoding: "utf8",
				env: { ...process.env, MMDC: stub },
			},
		);
		assert.equal(result.status, 0, result.stderr);
	},
);

it.skipIf(process.platform === "win32")(
	"render.mjs puts edge labels on the dark page color in the dark render only",
	() => {
		const dir = mkdtempSync(join(work, "edge-labels-"));
		const stub = join(dir, "mmdc");
		writeFileSync(
			stub,
			[
				"#!/usr/bin/env node",
				'const { readFileSync } = require("node:fs");',
				"const arg = (flag) => process.argv[process.argv.indexOf(flag) + 1];",
				'const { themeCSS } = JSON.parse(readFileSync(arg("-c"), "utf8"));',
				'const onPage = themeCSS.includes(".edgeLabel .labelBkg { background-color: #0f172a; }");',
				'process.exit(onPage === arg("-o").endsWith(".dark.png") ? 0 : 1);',
				"",
			].join("\n"),
		);
		chmodSync(stub, 0o755);
		const diagram = join(dir, "x.mmd");
		writeFileSync(diagram, "flowchart LR\n  a -->|label| b\n");
		const result = spawnSync("node", [RENDER, diagram, "--no-fetch"], {
			encoding: "utf8",
			env: { ...process.env, MMDC: stub },
		});
		assert.equal(result.status, 0, result.stderr);
	},
);

it.skipIf(process.platform === "win32")(
	"render.mjs puts labels inside a filled group on the group's dark fill, after the page-color rule",
	() => {
		const dir = mkdtempSync(join(work, "group-labels-"));
		const stub = join(dir, "mmdc");
		writeFileSync(
			stub,
			[
				"#!/usr/bin/env node",
				'const { readFileSync } = require("node:fs");',
				"const arg = (flag) => process.argv[process.argv.indexOf(flag) + 1];",
				'if (arg("-o").endsWith(".layout.svg")) return require("node:fs").writeFileSync(arg("-o"), "<svg/>");',
				'const { themeCSS } = JSON.parse(readFileSync(arg("-c"), "utf8"));',
				'const dark = arg("-o").endsWith(".dark.png");',
				'const fill = dark ? "#2a1f12" : "#fff7ed";',
				'const group = themeCSS.indexOf(\'[data-id="L_a_b_0"] .labelBkg { background-color: \' + fill + "; }");',
				'const page = themeCSS.indexOf(".edgeLabel .labelBkg { background-color: #0f172a; }");',
				"process.exit(group >= 0 && (!dark || page < group) ? 0 : 1);",
				"",
			].join("\n"),
		);
		chmodSync(stub, 0o755);
		const diagram = join(dir, "x.mmd");
		writeFileSync(
			diagram,
			"flowchart LR\n  subgraph g[G]\n    a\n    b\n  end\n  a -->|x| b\n  style g fill:#fff7ed\n",
		);
		const result = spawnSync("node", [RENDER, diagram, "--no-fetch"], {
			encoding: "utf8",
			env: { ...process.env, MMDC: stub },
		});
		assert.equal(result.status, 0, result.stderr);
	},
);

it.skipIf(process.platform === "win32")(
	"render.mjs appends the diagram's own themeCSS, in dark colors for the dark render, after its own rules",
	() => {
		const dir = mkdtempSync(join(work, "diagram-css-"));
		const stub = join(dir, "mmdc");
		writeFileSync(
			stub,
			[
				"#!/usr/bin/env node",
				'const { readFileSync } = require("node:fs");',
				"const arg = (flag) => process.argv[process.argv.indexOf(flag) + 1];",
				'const { themeCSS } = JSON.parse(readFileSync(arg("-c"), "utf8"));',
				'const color = arg("-o").endsWith(".dark.png") ? "#475569" : "#cbd5e1";',
				'const own = themeCSS.indexOf(".image-shape { background-color: transparent; }");',
				'const diagram = themeCSS.indexOf(".x { stroke: " + color + "; }");',
				"process.exit(own >= 0 && diagram > own ? 0 : 1);",
				"",
			].join("\n"),
		);
		chmodSync(stub, 0o755);
		const diagram = join(dir, "x.mmd");
		writeFileSync(
			diagram,
			'---\nconfig:\n  theme: neutral\n  themeCSS: ".x { stroke: #cbd5e1; }"\n---\ngantt\n  a :a1, 2026-01-01, 1d\n',
		);
		const result = spawnSync("node", [RENDER, diagram, "--no-fetch"], {
			encoding: "utf8",
			env: { ...process.env, MMDC: stub },
		});
		assert.equal(result.status, 0, result.stderr);
	},
);

it.skipIf(process.platform === "win32")(
	"render.mjs widens image-node labels and clears their label boxes",
	() => {
		const dir = mkdtempSync(join(work, "theme-"));
		const stub = join(dir, "mmdc");
		writeFileSync(
			stub,
			[
				"#!/usr/bin/env node",
				'const { readFileSync } = require("node:fs");',
				"const arg = (flag) => process.argv[process.argv.indexOf(flag) + 1];",
				'const { themeCSS } = JSON.parse(readFileSync(arg("-c"), "utf8"));',
				'const cleared = [".image-shape", ".image-shape p", ".image-shape .labelBkg"].every((selector) =>',
				'  themeCSS.includes(selector + " { background-color: transparent; }"));',
				'const widened = readFileSync(arg("-i"), "utf8").includes("min-width:200px");',
				"process.exit(cleared && widened ? 0 : 1);",
				"",
			].join("\n"),
		);
		chmodSync(stub, 0o755);
		const diagram = join(dir, "x.mmd");
		writeFileSync(
			diagram,
			'flowchart LR\n  a@{ img: "icon:neon", label: "a" }\n',
		);
		const result = spawnSync(
			"node",
			[
				RENDER,
				diagram,
				"--icons-dir",
				iconsDir(),
				"--no-fetch",
				"--theme",
				"light",
			],
			{
				encoding: "utf8",
				env: { ...process.env, MMDC: stub },
			},
		);
		assert.equal(result.status, 0, result.stderr);
	},
);

const GROUPED = [
	"---",
	"config:",
	"  theme: neutral",
	'  themeCSS: ".grid .tick line { stroke: #e2e8f0; }"',
	"---",
	"flowchart LR",
	"  subgraph vercel[Vercel]",
	'    next@{ img: "data:image/svg+xml;base64,AAAA", label: "Next.js" }',
	'    hono@{ img: "data:image/svg+xml;base64,AAAA", label: "Hono" }',
	"  end",
	'  neon@{ img: "data:image/svg+xml;base64,AAAA", label: "Neon" }',
	"  next -->|RPC| hono",
	"  hono -->|SQL| neon",
	"  style vercel fill:#f5f8ff,stroke:#93b4f5",
	"",
].join("\n");

function themeCssOf(markdown: string | undefined) {
	const value = markdown?.match(/^ {2}themeCSS: "([^"]*)"$/m);
	assert.ok(value, String(markdown));
	return value[1] ?? "";
}

it("portableMarkdown wraps the diagram in one mermaid block with every label rule in its frontmatter themeCSS", () => {
	const markdown = portableMarkdown(GROUPED, "x") ?? "";
	assert.match(
		markdown,
		/^<!-- x\.mmd [^\n]*-->\n\n```mermaid\n---\nconfig:\n/,
	);
	assert.ok(markdown.endsWith("\n```\n"));
	assert.equal(markdown.match(/themeCSS:/g)?.length, 1);
	const css = themeCssOf(markdown);
	assert.ok(
		css.includes(".grid .tick line { stroke: #e2e8f0; }"),
		"keeps the diagram's own themeCSS",
	);
	assert.ok(
		css.includes(
			"[data-id='L_next_hono_0'] .labelBkg { background-color: #f5f8ff; }",
		),
		css,
	);
	assert.ok(
		!css.includes("L_hono_neon_0"),
		"an edge leaving the group keeps its label box",
	);
	assert.ok(css.includes(".flowchartTitleText { fill: #64748b; }"), css);
});

it("portableMarkdown clears the label boxes of names inside a filled group only", () => {
	const css = themeCssOf(portableMarkdown(GROUPED, "x"));
	for (const id of ["next", "hono"]) {
		for (const part of ["", " p", " .labelBkg"]) {
			assert.ok(
				css.includes(
					`[id*='flowchart-${id}-']${part} { background-color: transparent; }`,
				),
				`${id}${part}`,
			);
		}
	}
	assert.ok(
		!css.includes("flowchart-neon-"),
		"a name outside the groups keeps its box, to read on a dark page",
	);
});

it("portableMarkdown adds a frontmatter to a diagram without one", () => {
	const markdown = portableMarkdown("flowchart LR\n  a --> b\n", "x") ?? "";
	assert.match(
		markdown,
		/```mermaid\n---\nconfig:\n {2}themeCSS: "[^"\n]+"\n {2}fontFamily: [^\n]+\n---\nflowchart LR\n/,
	);
});

it("portableMarkdown takes a block of exactly 50,000 characters and refuses one more", () => {
	const css = themeCssOf(portableMarkdown("flowchart LR\n", "x"));
	const head = `---\nconfig:\n  themeCSS: "${css}"\n  fontFamily: 'Arimo, Arial, "Liberation Sans", sans-serif'\n---\nflowchart LR\n  a["`;
	const fill = (length: number) =>
		`flowchart LR\n  a["${"x".repeat(length - head.length - 3)}"]\n`;
	assert.ok(portableMarkdown(fill(50_000), "x"));
	assert.equal(portableMarkdown(fill(50_001), "x"), undefined);
});

it("portableMarkdown adds config to a frontmatter that has only a title", () => {
	const markdown =
		portableMarkdown("---\ntitle: T\n---\nflowchart LR\n  a --> b\n", "x") ??
		"";
	assert.match(
		markdown,
		/```mermaid\n---\ntitle: T\nconfig:\n {2}themeCSS: "[^"\n]+"\n {2}fontFamily: [^\n]+\n---\nflowchart LR\n/,
	);
});

it("portableMarkdown sets the font the labels were measured in, so a page's default font does not wrap them", () => {
	assert.ok(
		portableMarkdown(GROUPED, "x")?.includes(
			`\n  fontFamily: 'Arimo, Arial, "Liberation Sans", sans-serif'\n`,
		),
	);
});

it("portableMarkdown writes <small> as a span of the same size, since GitHub's mermaid drops <small> and keeps span", () => {
	const diagram =
		'flowchart LR\n  a@{ label: "<b>Vercel</b><br/><small>apps/web</small>" }\n  b["<small class=x>b</small>"]\n';
	const markdown = portableMarkdown(diagram, "x") ?? "";
	assert.ok(
		markdown.includes(
			'label: "<b>Vercel</b><br/><span style=font-size:smaller>apps/web</span>"',
		),
		markdown,
	);
	assert.ok(
		markdown.includes('b["<span style=font-size:smaller>b</span>"]'),
		markdown,
	);
	assert.ok(!/<\/?small/.test(markdown), markdown);
});

it("portableMarkdown keeps a font the diagram sets itself", () => {
	const diagram =
		"---\nconfig:\n  fontFamily: Inter\n---\nflowchart LR\n  a --> b\n";
	const markdown = portableMarkdown(diagram, "x") ?? "";
	assert.equal(markdown.match(/fontFamily:/g)?.length, 1);
	assert.ok(markdown.includes("  fontFamily: Inter\n"));
});

it("portableMarkdown refuses a block-style themeCSS, whose rules it cannot carry over", () => {
	const diagram =
		"---\nconfig:\n  themeCSS: |\n    .a { fill: red; }\n  theme: neutral\n---\nflowchart LR\n  a\n";
	assert.throws(() => portableMarkdown(diagram, "x"), /one quoted line/);
});

it.skipIf(process.platform === "win32")(
	"render.mjs --svg --portable writes the PNGs, SVGs whose labels may overflow their boxes, and the portable Markdown",
	() => {
		const dir = mkdtempSync(join(work, "svg-"));
		const cache = join(dir, "cache");
		const stub = join(dir, "mmdc");
		writeFileSync(
			stub,
			[
				"#!/usr/bin/env node",
				'const { readFileSync, writeFileSync } = require("node:fs");',
				"const arg = (flag) => process.argv[process.argv.indexOf(flag) + 1];",
				'const { fontFamily, themeCSS } = JSON.parse(readFileSync(arg("-c"), "utf8"));',
				'if (!fontFamily.startsWith("Arimo, Arial")) process.exit(1);',
				'if (!themeCSS.includes(".label [height], .cluster-label [height] { overflow: visible; }")) process.exit(1);',
				'writeFileSync(arg("-o"), "<svg id=\\"my-svg\\"><g/></svg>");',
				"",
			].join("\n"),
		);
		chmodSync(stub, 0o755);
		const diagram = join(dir, "x.mmd");
		writeFileSync(diagram, "flowchart LR\n  a --> b\n");
		const result = spawnSync(
			"node",
			[
				RENDER,
				diagram,
				"--icons-dir",
				join(cache, "icons"),
				"--no-fetch",
				"--svg",
				"--portable",
			],
			{ encoding: "utf8", env: { ...process.env, MMDC: stub } },
		);
		assert.equal(result.status, 0, result.stderr);
		assert.deepEqual(
			readdirSync(dir)
				.filter((name) => name.startsWith("x."))
				.sort(),
			["x.dark.png", "x.dark.svg", "x.mmd", "x.png", "x.portable.md", "x.svg"],
		);
		for (const svg of ["x.svg", "x.dark.svg"]) {
			assert.equal(
				readFileSync(join(dir, svg), "utf8"),
				'<svg id="my-svg"><g/></svg>',
				"no font is embedded",
			);
		}
	},
);

it("portableMarkdown boxes the title of an unfilled group in the nearest filled group's color, or white", () => {
	const diagram = [
		"flowchart LR",
		"  subgraph cloud[Cloud]",
		"    subgraph vpc[VPC]",
		"      a",
		"    end",
		"  end",
		"  subgraph team[Team]",
		"    subgraph sub[Sub]",
		"      b",
		"    end",
		"  end",
		"  style cloud fill:none,stroke:#1e293b",
		"  style team fill:#f5f8ff",
		"",
	].join("\n");
	const css = themeCssOf(portableMarkdown(diagram, "x"));
	for (const id of [
		"[id='cloud']",
		"[id$='-cloud']",
		"[id='vpc']",
		"[id$='-vpc']",
	]) {
		assert.ok(
			css.includes(
				`.cluster${id} .cluster-label p { background-color: #ffffff; }`,
			),
			id,
		);
	}
	assert.ok(
		css.includes(
			".cluster[id$='-sub'] .cluster-label p { background-color: #f5f8ff; }",
		),
		css,
	);
	assert.ok(
		!css.includes("-team'] .cluster-label"),
		"a filled group's title stands on its fill",
	);
});

it("liftTitleLogos takes each group title's logo out of the title, keeps its data URI and size, and lists the groups", () => {
	const uri = "data:image/svg+xml;base64,PHN2Zy8+";
	const diagram = [
		"flowchart LR",
		`  subgraph vercel["<img src='${uri}' width='26' height='26' style='vertical-align:middle'/> <b>Vercel</b>"]`,
		"    a",
		"  end",
		"  subgraph data[Data stores]",
		"    b",
		"  end",
		`  c@{ img: "${uri}" }`,
		"",
	].join("\n");
	const { text, logos, groups } = liftTitleLogos(diagram);
	assert.ok(text.includes('  subgraph vercel["<b>Vercel</b>"]\n'), text);
	assert.ok(text.includes("  subgraph data[Data stores]\n"));
	assert.ok(text.includes(`c@{ img: "${uri}" }`), "node images stay");
	assert.deepEqual([...logos], [["vercel", { uri, size: 26 }]]);
	assert.deepEqual(groups, ["vercel", "data"]);
});

it("titleLogoCss draws each logo in front of its title's name, and no logo in a group whose id ends like it", () => {
	const uri = "data:image/svg+xml;base64,PHN2Zy8+";
	const css = titleLogoCss(
		["edge-vpc", "vpc"],
		new Map([["vpc", { uri, size: 26 }]]),
	);
	assert.match(
		css,
		/\.cluster\[id\$='-vpc'\] \.nodeLabel::before \{ content: ''; display: inline-block; width: 26px; height: 26px; [^}]*background: url\('data:image\/svg\+xml;base64,PHN2Zy8\+'\)/,
	);
	assert.ok(
		css.includes(".cluster[id$='-vpc'] .nodeLabel p { display: inline; }"),
		"the name stays on the logo's line",
	);
	const own = css.indexOf(".cluster[id$='-vpc'] .nodeLabel::before");
	const none = css.indexOf(
		".cluster[id$='-edge-vpc'] .nodeLabel::before { content: none; }",
	);
	assert.ok(
		own >= 0 && none > own,
		"the longer id's rule comes later and wins for edge-vpc",
	);
});

const CLUSTERS = [
	'<svg id="my-svg"><g class="clusters">',
	'<g class="cluster" id="my-svg-vercel" data-look="neo"><rect style="fill:#f5f8ff" x="318.5" y="12" width="212" height="305"/>',
	'<g class="cluster-label" transform="translate(385.75, 12)"><foreignObject width="77.6" height="26"></foreignObject></g></g>',
	'<g class="cluster" id="my-svg-edge-vercel"><rect x="600" y="40" width="300" height="200"/>',
	'<g class="cluster-label" transform="translate(700, 40)"><foreignObject width="100" height="24"></foreignObject></g></g>',
	"</g></svg>",
].join("");

it("groupTitleCss moves each group title's box to the group's top left and names the groups it found", () => {
	const { css, found } = groupTitleCss(CLUSTERS);
	const vercel =
		".cluster[id$='-vercel'] .cluster-label [height] { transform: translate(-55.25px, 6px); }";
	const edge =
		".cluster[id$='-edge-vercel'] .cluster-label [height] { transform: translate(-88px, 6px); }";
	assert.ok(css.includes(vercel) && css.includes(edge), css);
	assert.ok(
		css.indexOf(edge) > css.indexOf(vercel),
		"the longer id's rule comes later and wins for edge-vercel",
	);
	assert.deepEqual([...found].sort(), ["edge-vercel", "vercel"]);
});

function titleStub(dir: string, layout: string, check: string) {
	const stub = join(dir, "mmdc");
	writeFileSync(
		stub,
		[
			"#!/usr/bin/env node",
			'const { readFileSync, writeFileSync } = require("node:fs");',
			"const arg = (flag) => process.argv[process.argv.indexOf(flag) + 1];",
			'const { themeCSS } = JSON.parse(readFileSync(arg("-c"), "utf8"));',
			`if (arg("-o").endsWith(".layout.svg")) { ${layout} }`,
			check,
			"",
		].join("\n"),
	);
	chmodSync(stub, 0o755);
	return stub;
}

const TITLE_DIAGRAM =
	"flowchart LR\n  subgraph vercel[\"<img src='data:image/svg+xml;base64,PHN2Zy8+' width='26'/> <b>Vercel</b>\"]\n    a\n  end\n";

it.skipIf(process.platform === "win32")(
	"render.mjs measures the titles with their logos in a first render and moves them in every output",
	() => {
		const dir = mkdtempSync(join(work, "titles-"));
		const layout = `if (!themeCSS.includes("::before { content: ''")) process.exit(1); writeFileSync(arg("-o"), ${JSON.stringify(CLUSTERS)}); process.exit(0);`;
		const rule =
			".cluster[id$='-vercel'] .cluster-label [height] { transform: translate(-55.25px, 6px); }";
		const stub = titleStub(
			dir,
			layout,
			`process.exit(themeCSS.includes(${JSON.stringify(rule)}) ? 0 : 1);`,
		);
		const diagram = join(dir, "x.mmd");
		writeFileSync(diagram, TITLE_DIAGRAM);
		const result = spawnSync(
			"node",
			[RENDER, diagram, "--no-fetch", "--portable"],
			{
				encoding: "utf8",
				env: { ...process.env, MMDC: stub },
			},
		);
		assert.equal(result.status, 0, result.stderr);
		assert.ok(
			readFileSync(join(dir, "x.portable.md"), "utf8").includes(
				"translate(-55.25px, 6px)",
			),
		);
	},
);

it.skipIf(process.platform === "win32")(
	"render.mjs fails a diagram whose first render fails, and one whose title logo has no title to go to",
	() => {
		const failures: [string, RegExp][] = [
			["process.exit(1);", /\(group titles\)/],
			[
				'writeFileSync(arg("-o"), "<svg/>"); process.exit(0);',
				/no group title for vercel/,
			],
		];
		for (const [layout, message] of failures) {
			const dir = mkdtempSync(join(work, "titles-fail-"));
			const stub = titleStub(dir, layout, "process.exit(0);");
			const diagram = join(dir, "x.mmd");
			writeFileSync(diagram, TITLE_DIAGRAM);
			const result = spawnSync(
				"node",
				[RENDER, diagram, "--no-fetch", "--portable"],
				{
					encoding: "utf8",
					env: { ...process.env, MMDC: stub },
				},
			);
			assert.equal(result.status, 1);
			assert.match(result.stderr, message);
			assert.equal(
				existsSync(join(dir, "x.png")) ||
					existsSync(join(dir, "x.portable.md")),
				false,
			);
		}
	},
);

it("portableMarkdown writes a themeCSS that mermaid accepts from a diagram: no <, > or url(data:", () => {
	const logos = new Map([
		["vercel", { uri: "data:image/svg+xml;base64,PHN2Zy8+", size: 26 }],
	]);
	const titleCss = `${titleLogoCss(["vercel"], logos)}\n${groupTitleCss(CLUSTERS).css}`;
	const diagram =
		"flowchart LR\n  subgraph vercel[Vercel]\n    a\n  end\n  style vercel fill:#f5f8ff\n";
	const css = themeCssOf(portableMarkdown(diagram, "x", titleCss));
	assert.ok(css.includes("translate(") && css.includes("::before"), css);
	// mermaid empties a diagram's themeCSS that holds any of these, and the diagram then loses every rule.
	assert.doesNotMatch(css, /[<>]|url\(data:/);
});

it("render.mjs stops with the fix when %% comments come before the frontmatter, which mermaid then fails to parse", () => {
	const dir = mkdtempSync(join(work, "frontmatter-"));
	const diagram = join(dir, "x.mmd");
	writeFileSync(
		diagram,
		"%% Source: a description\n---\ntitle: x\n---\nflowchart LR\n  a --> b\n",
	);
	const result = spawnSync("node", [RENDER, diagram, "--no-fetch"], {
		encoding: "utf8",
		env: { ...process.env, MMDC: join(dir, "missing-mmdc") },
	});
	assert.equal(result.status, 1);
	assert.match(result.stderr, /frontmatter .*first line/);
	assert.match(result.stderr, /below the diagram type line/);
});
