#!/usr/bin/env node
// Renders Mermaid files to PNG with mermaid-cli, in a light and a dark theme.
// `img: "icon:<spec>"` in a node is replaced with the logo as a data URI. <spec> is a fetch-icons.mjs spec
// (`neon`, `workers:cloudflare-workers`, `cli:lucide/square-terminal`); its name is the part before `:` or `=`.
// Logos are looked up in the icons dir, and a missing one is fetched into it. Logos never need to be committed.
// Every logo is placed on the same white square tile, and every image node's label gets the same minimum width, so
// tiles line up in a column. With `mergeEdges: true` each tile is also padded to the middle of its node, so edges meet
// it at its mid-height. Group titles go to the top left of their group, with their logo in front, and each group's
// frame is cut back to what it holds. For a flowchart, state or ER diagram it prints how many times edges cross.
//
// Usage: node render.mjs <file.mmd>... [--icons-dir <dir>] [--no-fetch] [--out <dir>] [--theme both|light|dark]
//                        [--scale <n>] [--svg] [--portable]
//   --icons-dir  default: ${XDG_CACHE_HOME:-~/.cache}/harnessforce-diagram/icons
//   --no-fetch   fail on a missing logo instead of fetching it
//   --out     default: next to each .mmd. Writes <name>.png and <name>.dark.png
//   --theme   default: both
//   --scale   default: 2 (text stays crisp when the PNG is viewed at full width)
//   --svg       also writes <name>.svg and <name>.dark.svg: self-contained, with the logos inside
//   --portable  also writes <name>.portable.md: a ```mermaid block with the logos inside, for pages that run mermaid
// mermaid-cli: $MMDC if set, else `npx -y @mermaid-js/mermaid-cli@12.2.0`. Chromium: $PUPPETEER_EXECUTABLE_PATH,
// and $MERMAID_PUPPETEER_CONFIG (a JSON file passed to mmdc -p, e.g. for --no-sandbox) when set.
import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultIconsDir, fetchIcons } from "./fetch-icons.mjs";

const MERMAID_CLI = "@mermaid-js/mermaid-cli@12.2.0";
// Inlined logos make the source far longer than mermaid's default maxTextSize of 50000 characters.
const MAX_TEXT_SIZE = 5_000_000;
// mermaid-cli scales the PNG of a diagram drawn with useMaxWidth into about 800 CSS px, so a 2,000 px diagram came out
// with its text at a third of its size. A diagram's own frontmatter can still turn it back on.
const NATURAL_WIDTH = Object.fromEntries(
	["flowchart", "sequence", "state", "er", "gantt"].map((type) => [
		type,
		{ useMaxWidth: false },
	]),
);
const RENDER_TIMEOUT_MS = 120_000;
const BACKGROUND = { light: "#ffffff", dark: "#0f172a" };
// Arimo, Arial and Liberation Sans (what Chromium on Linux draws for Arial) have the same widths. Labels are measured
// in whichever of them the renderer has, and Windows, macOS and most Linux desktops draw the SVG in one of them. No
// font is embedded, so the SVG carries no font license.
const FONT_FAMILY = 'Arimo, Arial, "Liberation Sans", sans-serif';
// A viewer with none of those fonts draws a wider one (Android draws Roboto), and mermaid's label boxes cut the end of
// each edge label off ("Prisma, reac"). Letting the text overflow its box shows the whole label, a few pixels over
// the line on such a viewer and unchanged on the others. A label's box is the only element with a height in it; the
// rule names no element, because mermaid lowercases the name and an SVG file then matches "foreignobject" to nothing.
const SVG_TEXT_CSS =
	".label [height], .cluster-label [height] { overflow: visible; }";
// mermaid's default maxTextSize; GitHub, mermaid.live and other pages that run mermaid refuse a longer diagram.
const PORTABLE_MAX_CHARS = 50_000;
// The themes put image-node labels on white or gray boxes, which alignImageNodes widens into bands across group
// fills. Without them the label stands on the page or the group, like the group title above it. themeCSS only paints,
// so it does not undo the widening.
const IMAGE_LABEL_CSS = [
	".image-shape",
	".image-shape p",
	".image-shape .labelBkg",
]
	.map((selector) => `${selector} { background-color: transparent; }`)
	.join("\n");
// The dark theme puts edge labels on gray boxes, on which a label colored like its edge (mermaid-layout.md, Style)
// is hard to read. On the page color they read as on the light page.
const DARK_EDGE_LABEL_CSS = [
	".edgeLabel",
	".edgeLabel p",
	".edgeLabel .labelBkg",
]
	.map((selector) => `${selector} { background-color: ${BACKGROUND.dark}; }`)
	.join("\n");
// The light palette of references/mermaid-layout.md (Style) and its dark counterpart. Logos keep the white tile
// they were made for; node text turns light to stand on the dark page.
const DARK_COLORS = {
	"#f5f8ff": "#16213a",
	"#93b4f5": "#3b5ea8",
	"#fff7ed": "#2a1f12",
	"#f59e0b": "#b45309",
	"#f0fdf4": "#12261a",
	"#86efac": "#2f855a",
	"#fef2f2": "#2a1416",
	"#f87171": "#b91c1c",
	"#f8fafc": "#1e293b",
	"#cbd5e1": "#475569",
	"#2563eb": "#60a5fa",
	"#64748b": "#94a3b8",
	"#94a3b8": "#64748b",
	"#dc2626": "#f87171",
	"#d97706": "#fbbf24",
	"#1e293b": "#e2e8f0",
};
const MIME = { svg: "image/svg+xml", png: "image/png", webp: "image/webp" };
const PLACEHOLDER = /(["'])icon:([^"'\s]+)\1/g;
// A 60 px square tile, the logo fit into a box 34 px tall and up to 44 px wide: a square mark keeps 13 px above and
// below and a wordmark 8 px at the sides, so no logo touches the frame, and in the examples' renders the square marks
// and the wordmarks looked about equally large. Mermaid draws the image node at the tile's square shape, so every
// tile is the same size and holds its logo at the same size.
const TILE = 60;
const LOGO_BOX =
	'x="8" y="13" width="44" height="34" preserveAspectRatio="xMidYMid meet"';
// AWS service icons carry their own colored square and work on light and dark pages; AWS's drawing rules place them
// bare, so a white tile would only frame the square twice.
const BARE_LOGO_BOX = `x="0" y="0" width="${TILE}" height="${TILE}" preserveAspectRatio="xMidYMid meet"`;
const BARE_SPEC = /:aws\//;
const TILE_FRAME = `<rect x="0.6" y="0.6" width="58.8" height="58.8" rx="10" fill="#ffffff" stroke="#cbd5e1" stroke-width="1.2"/>`;
// Lucide icons draw inside a 2-unit margin of their 24-unit grid; brand marks fill their viewBox.
const LINE_ICON_MARGIN = { from: "0 0 24 24", to: "2 2 20 20" };
const DEFAULT_WRAPPING_WIDTH = 200;
const TILE_HEAD = `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE}" height="${TILE}" viewBox="0 0 ${TILE} ${TILE}">`;
const TILE_URI =
	/(\bimg:\s*)(["'])data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)\2/;
const NODE_HEIGHT = /([{,]\s*h:\s*)(\d+(?:\.\d+)?)/;
// mermaid's image node puts 8 px between the image and its label, and makes the label's box 4 px taller than its text.
const IMAGE_LABEL_GAP = 8;
const LABEL_BOX_PADDING = 4;
// One line of label text in the template's tile class: 18 px at mermaid's line-height of 1.5. Lines are counted by
// <br/>; a label that wraps is taller than counted and leaves its tile a little above the middle.
const LABEL_LINE_HEIGHT = 27;

// Attribute values may hold ">" and a comment before the root may mention "<svg", so the root tag is parsed whole.
const SVG_ROOT = /<svg((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/;

// Provider icons carry titles, indentation and coordinates to seven decimals, which made an AWS diagram of ten
// services too long for a portable block. Rounding an attribute's numbers to two decimals moves a point by at most
// 0.005 of a unit of its coordinate system, far below a pixel of a 34 px logo, and drops about 40% of an AWS icon.
// Transforms keep their digits: a scale rounded to two decimals could move a far point by more.
const LONG_DECIMAL = /\d+\.\d{3,}/g;
const ATTRIBUTE = /(\s[\w:-]+)=(["'])([^"']*)\2/g;
const roundDecimal = (number) => String(Number(Number(number).toFixed(2)));

function compactSvg(markup) {
	return markup
		.replace(/<title\b[^>]*>[\s\S]*?<\/title>/g, "")
		.replace(/>\s+</g, "><")
		.replace(/^\s+/, "")
		.replace(ATTRIBUTE, (attribute, name, quote, value) =>
			/transform$/i.test(name)
				? attribute
				: `${name}=${quote}${value.replace(LONG_DECIMAL, roundDecimal)}${quote}`,
		);
}

function placeSvgLogo(svg, logoBox) {
	const source = svg.replace(/<!--[\s\S]*?-->/g, "");
	const root = source.match(SVG_ROOT);
	if (!root) throw new Error("no <svg> root element");
	const [tag, attributes, selfClosing] = root;
	const attribute = (name) =>
		attributes.match(new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`))?.[1];
	const size = [attribute("width"), attribute("height")].map((value) =>
		Number.parseFloat(value ?? ""),
	);
	let viewBox =
		attribute("viewBox") ??
		(size.every((n) => n > 0) ? `0 0 ${size[0]} ${size[1]}` : undefined);
	if (viewBox?.trim() === LINE_ICON_MARGIN.from && attribute("stroke"))
		viewBox = LINE_ICON_MARGIN.to;
	const kept = attributes.replace(
		/\s(width|height|x|y|viewBox|preserveAspectRatio)\s*=\s*("[^"]*"|'[^']*')/g,
		"",
	);
	const box = viewBox ? `${logoBox} viewBox="${viewBox}"` : logoBox;
	const rest = compactSvg(source.slice(source.indexOf(tag) + tag.length));
	return `<svg${kept} ${box}${selfClosing}>${rest}`;
}

// Wraps a logo file in the tile SVG. An SVG logo is nested as markup; a raster logo as an image. A bare logo fills the
// tile's square without the white frame.
export function tile(file, { bare = false } = {}) {
	const ext = file.slice(file.lastIndexOf(".") + 1);
	const box = bare ? BARE_LOGO_BOX : LOGO_BOX;
	const logo =
		ext === "svg"
			? placeSvgLogo(readFileSync(file, "utf8"), box)
			: `<image ${box} href="data:${MIME[ext]};base64,${readFileSync(file).toString("base64")}"/>`;
	return `${TILE_HEAD}${bare ? "" : TILE_FRAME}${logo}</svg>`;
}

function fetchedAs(dir, name) {
	const manifestPath = join(dir, "manifest.json");
	if (!existsSync(manifestPath)) return undefined;
	return JSON.parse(readFileSync(manifestPath, "utf8"))[name]?.spec;
}

// Replaces each `icon:<spec>` with the tile of the first <name>.<svg|png|webp> found in dirs. Returns the specs not
// found or cached under another spec, and the bare specs (`icon:list`) whose logo the cache holds only because it was fetched under a fuller spec
// (`list:lucide/list-checks`): such a diagram renders here but not from an empty cache.
export function inlineIcons(text, dirs) {
	const missing = new Set();
	const incomplete = new Map();
	const inlined = text.replace(PLACEHOLDER, (match, quote, spec) => {
		const name = spec.split(/[:=]/)[0];
		const dir = dirs.find((d) =>
			Object.keys(MIME).some((ext) => existsSync(join(d, `${name}.${ext}`))),
		);
		const file =
			dir &&
			Object.keys(MIME)
				.map((ext) => join(dir, `${name}.${ext}`))
				.find(existsSync);
		if (!file) {
			missing.add(spec);
			return match;
		}
		const cachedAs = fetchedAs(dir, name);
		// Another diagram left a different logo under this name: fetch this spec again rather than draw that one.
		if (spec !== name && cachedAs && cachedAs !== spec) {
			missing.add(spec);
			return match;
		}
		if (spec === name && cachedAs && cachedAs !== name)
			incomplete.set(spec, { spec, fetchedAs: cachedAs });
		const svg = tile(file, { bare: BARE_SPEC.test(spec) });
		return `${quote}data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}${quote}`;
	});
	return {
		text: inlined,
		missing: [...missing],
		incomplete: [...incomplete.values()],
	};
}

// Grows the tile's canvas by `top` and `bottom` units of empty space, or returns undefined for an image that is not a
// tile of inlineIcons.
function padTile(base64, top, bottom) {
	const svg = Buffer.from(base64, "base64").toString("utf8");
	if (!svg.startsWith(TILE_HEAD)) return undefined;
	const height = Number((TILE + top + bottom).toFixed(2));
	const head = `<svg xmlns="http://www.w3.org/2000/svg" width="${TILE}" height="${height}" viewBox="0 ${-Number(top.toFixed(2))} ${TILE} ${height}">`;
	return Buffer.from(head + svg.slice(TILE_HEAD.length)).toString("base64");
}

// An image node is as wide as its label, and ELK lines up the nodes of a column by one edge, not by their centers.
// Every label of an image node gets the diagram's wrapping width as its minimum, so the nodes are equally wide and
// their tiles share one center line. The width is read from the YAML frontmatter only, not from %%{init}%%.
//
// With `mergeEdges: true`, ELK attaches every edge on a side of a node at the middle of that side, and the side spans
// the tile and the label under it, so without padding edges meet the tile at its bottom corner. Each tile then gets empty space on the
// side away from its label, as tall as the label and the gap, which puts the tile in the middle of its node and the
// edges at the tile's mid-height. Only tiles made by inlineIcons are padded, and only nodes that
// give their height (`h:`).
export function alignImageNodes(text) {
	const width = Number(
		text.match(/^\s+wrappingWidth:\s*(\d+)/m)?.[1] ?? DEFAULT_WRAPPING_WIDTH,
	);
	const mergesEdges = /^\s+mergeEdges:\s*true\b/m.test(text);
	return text.replace(/@\{[^}]*\}/g, (block) => {
		if (!/\bimg:/.test(block)) return block;
		let labelHeight = 0;
		const labeled = block.replace(
			/(\blabel:\s*)(["'])(.*?)\2/,
			(_, head, quote, label) => {
				const inner = quote === '"' ? "'" : '"';
				labelHeight = label.split(/<br\s*\/?>/i).length * LABEL_LINE_HEIGHT;
				return `${head}${quote}<span style=${inner}display:inline-block;min-width:${width}px${inner}>${label}</span>${quote}`;
			},
		);
		const nodeHeight = Number(labeled.match(NODE_HEIGHT)?.[2]);
		if (!mergesEdges || labelHeight === 0 || !(nodeHeight > 0)) return labeled;
		const pad = IMAGE_LABEL_GAP + labelHeight + LABEL_BOX_PADDING;
		const padUnits = (pad * TILE) / nodeHeight;
		const labelOnTop = /\bpos:\s*(["']?)t\1\s*[,}]/.test(block);
		const tileUri = labeled.match(TILE_URI);
		const padded =
			tileUri &&
			padTile(tileUri[3], labelOnTop ? 0 : padUnits, labelOnTop ? padUnits : 0);
		if (!padded) return labeled;
		return labeled
			.replace(TILE_URI, `$1$2data:image/svg+xml;base64,${padded}$2`)
			.replace(NODE_HEIGHT, `$1${nodeHeight + pad}`);
	});
}

// A plain edge `a --> b`, `a ---|label| b`, `a -.-> b`; chains and `&` lists are not matched.
const EDGE =
	/^([\w-]+)\s*(?:<?(?:--+|==+|-\.+-)[>ox]?|~~~)\s*(?:\|[^|]*\|\s*)?([\w-]+)\s*$/;
const NODE = /^([\w-]+)\s*(?:@\{|[[({>]|$)/;
const LABEL_PARTS = [".labelBkg", ".edgeLabel", ".edgeLabel p"];

// Edge labels stand on a box of the page color (or the theme's label color), which showed as a dark patch on the fill
// of a group. An edge between two nodes of one filled group has its label inside that group, so the label gets the
// fill of the innermost filled group that holds both ends. Labels of edges between groups stay on the page color.
// Group membership is read from node lines inside a subgraph (`id`, `id[...]`, `id@{...}`), not from edge lines or
// `:::`; a node it misses keeps its label on the page color. mermaid tags each label with data-id L_<from>_<to>_<n>,
// where n is 0, then 2, 3, … for further edges between the same two nodes (flowDb addSingleLink).
function readGroups(text) {
	const fills = new Map();
	for (const [, id, fill] of text.matchAll(
		/^\s*style\s+([\w-]+)\s+[^\n]*?\bfill:\s*(#[0-9a-fA-F]{3,8})\b/gm,
	)) {
		fills.set(id, fill);
	}
	const groupsOf = new Map();
	const ancestorsOf = new Map();
	const groups = [];
	const edges = [];
	for (const line of text.split("\n")) {
		const trimmed = line.trim();
		const subgraph = trimmed.match(/^subgraph\b\s*([\w-]+)?/);
		const edge = trimmed.match(EDGE);
		const node = trimmed.match(NODE);
		if (subgraph) {
			if (subgraph[1]) ancestorsOf.set(subgraph[1], [...groups].reverse());
			groups.push(subgraph[1] ?? "");
		} else if (trimmed === "end") groups.pop();
		else if (edge) edges.push([edge[1], edge[2]]);
		else if (node && groups.length > 0 && !groupsOf.has(node[1]))
			groupsOf.set(node[1], [...groups].reverse());
	}
	return { fills, groupsOf, ancestorsOf, edges };
}

// The data-id of each edge whose two ends are in one filled group, and the fill of the innermost such group.
function edgesInFilledGroups(text) {
	const { fills, groupsOf, edges } = readGroups(text);
	const counts = new Map();
	const inside = [];
	for (const [from, to] of edges) {
		const pair = `${from}\0${to}`;
		const earlier = counts.get(pair) ?? 0;
		counts.set(pair, earlier + 1);
		const n = earlier === 0 ? 0 : earlier + 1;
		const groupsOfTo = new Set(groupsOf.get(to) ?? []);
		const innermostFilled = (groupsOf.get(from) ?? []).find(
			(group) => groupsOfTo.has(group) && fills.has(group),
		);
		if (innermostFilled)
			inside.push({
				id: `L_${from}_${to}_${n}`,
				fill: fills.get(innermostFilled),
			});
	}
	return inside;
}

export function groupEdgeLabelCss(text) {
	return edgesInFilledGroups(text)
		.flatMap(({ id, fill }) =>
			LABEL_PARTS.map(
				(part) => `[data-id="${id}"] ${part} { background-color: ${fill}; }`,
			),
		)
		.join("\n");
}

// render.mjs passes its own themeCSS through the config file given to mermaid-cli, which replaces a themeCSS in the
// diagram's frontmatter, so a gantt chart's grid color or a vertical marker's width would be lost. The frontmatter value
// (one quoted line under config:; escapes inside it are not read) is returned to be appended to render.mjs's own CSS.
export function diagramThemeCss(text) {
	const frontmatter = text.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
	const value = frontmatter.match(/^\s+themeCSS:\s*(["'])(.*)\1\s*$/m);
	return value ? value[2] : "";
}

// In dark mode GitHub draws the block on a dark page, where the white boxes of edge labels and of names standing on
// the page showed as white patches. Inverting a label turns its text light, in about the hue it had, and an edge
// label's box near black, which still hides the line under it; a name under a tile has no line under it and loses its
// box. The text color cannot be set instead, since linkStyle and classDef write it inline with !important. A filled
// group stays light in both modes, so the labels on its fill are left alone. Dark mode is read from the viewer's
// color scheme (prefers-color-scheme), which a diagram's CSS can see; GitHub's own mode setting it cannot.
const DARK_PAGE_LABEL = "filter: invert(0.94) hue-rotate(180deg);";

// A ```mermaid block keeps its light colors on every page, so on a dark page (GitHub in dark mode) a name drawn in
// dark ink straight on the page vanishes. Names keep the theme's white label box, except inside a filled group, whose
// light fill they stand on in both modes; the title of an unfilled group gets a box of the nearest filled group's
// color, or white; the diagram title, which has no box, is gray. The diagram itself cannot take a background: GitHub's
// mermaid scopes even `&` to the diagram's descendants. Elements are matched by mermaid's ids, <svg id>-<group> and
// <svg id>-flowchart-<node>-<n> (<group> and flowchart-<node>-<n> before mermaid 12), so a node `web` also matches
// `web-api`, and a group `vpc` also matches `edge-vpc`.
export function portableCss(text) {
	const { fills, groupsOf, ancestorsOf } = readGroups(text);
	const rules = [".flowchartTitleText { fill: #64748b; }"];
	for (const [group, ancestors] of ancestorsOf) {
		if (fills.has(group)) continue;
		const filled = ancestors.find((ancestor) => fills.has(ancestor));
		const box = filled ? fills.get(filled) : "#ffffff";
		for (const id of [`[id='${group}']`, `[id$='-${group}']`]) {
			rules.push(
				`.cluster${id} .cluster-label p { background-color: ${box}; }`,
			);
		}
	}
	const dark = [
		`.edgeLabel .labelBkg, .image-shape .labelBkg { ${DARK_PAGE_LABEL} }`,
		".image-shape .labelBkg, .image-shape .labelBkg * { background-color: transparent; }",
	];
	for (const [id, groups] of groupsOf) {
		if (!groups.some((group) => fills.has(group))) continue;
		for (const part of ["", " p", " .labelBkg"]) {
			rules.push(
				`[id*='flowchart-${id}-']${part} { background-color: transparent; }`,
			);
		}
		dark.push(
			`.image-shape[id*='flowchart-${id}-'] .labelBkg { filter: none; }`,
		);
	}
	for (const { id } of edgesInFilledGroups(text))
		dark.push(`.edgeLabel [data-id="${id}"] .labelBkg { filter: none; }`);
	rules.push(`@media (prefers-color-scheme: dark) { ${dark.join(" ")} }`);
	return rules.join("\n");
}

// Group titles go to the top left of their group, the logo in front of the name, as architecture diagrams usually
// place them; mermaid centers them on top. GitHub's mermaid removes an <img> from a group title but draws images that
// CSS puts in, so the logo leaves the title and comes back through CSS, in every output alike.
const TITLE_INSET = { x: 12, y: 6 };
const TITLE_LOGO_GAP = 6;
// Rule 44 of mermaid-layout.md draws title logos 26 px wide; a title <img> that names no width gets the same.
const TITLE_LOGO_SIZE = 26;
const TITLE_LOGO = /<img\b[^>]*?\bsrc=(["'])(data:[^"']+)\1[^>]*>\s*/;
const SUBGRAPH_ID = /^\s*subgraph\s+([\w-]+)/;
// .cluster[id$='-vpc'] also matches the group edge-vpc. Rules of equal specificity are ordered by id length, so the
// longer id's own rule comes later and wins.
const byLength = (a, b) => a.length - b.length;

export function liftTitleLogos(text) {
	const logos = new Map();
	const groups = [];
	const lines = text.split("\n").map((line) => {
		const id = line.match(SUBGRAPH_ID)?.[1];
		if (id) groups.push(id);
		const logo = id && line.match(TITLE_LOGO);
		if (!logo) return line;
		const size = Number(
			logo[0].match(/\bwidth=["']?(\d+(?:\.\d+)?)/)?.[1] ?? TITLE_LOGO_SIZE,
		);
		logos.set(id, { uri: logo[2], size });
		return line.replace(TITLE_LOGO, "");
	});
	return { text: lines.join("\n"), logos, groups };
}

// Draws each group title's logo in front of its name, for the first render and the outputs alike, so the first one
// measures every title at its final width. A group without a logo gets none, which a shorter id's rule would otherwise
// give it. The data URI is quoted, which mermaid accepts; it is the skill's own tile.
export function titleLogoCss(groups, logos) {
	const rules = [];
	for (const id of [...new Set(groups)].sort(byLength)) {
		const logo = logos.get(id);
		if (!logo) {
			rules.push(
				`.cluster[id$='-${id}'] .nodeLabel::before { content: none; }`,
			);
			continue;
		}
		rules.push(
			`.cluster[id$='-${id}'] .nodeLabel p { display: inline; }`,
			`.cluster[id$='-${id}'] .nodeLabel::before { content: ''; display: inline-block; width: ${logo.size}px; height: ${logo.size}px; margin-right: ${TITLE_LOGO_GAP}px; vertical-align: middle; background: url('${logo.uri}') center / contain no-repeat; }`,
		);
	}
	return rules.join("\n");
}

// mermaid keeps a group's frame this far from its contents on every side (SUBGRAPH_PADDING in its ELK layout).
const FRAME_GAP = 24;
const N = "(-?\\d+(?:\\.\\d+)?(?:e-?\\d+)?)";
const TRANSLATE = new RegExp(`transform="translate\\(${N},\\s*${N}\\)"`);
const round2 = (value) => Number(value.toFixed(2));

// The parts of an SVG mermaid drew that decide where a group's contents start and end: group frames and titles, image
// nodes with the part of their image the tile fills, other nodes (by center only), edges' points and edge labels.
function readLayout(svg) {
	const prefix = `${svg.match(/<svg\b[^>]*?\sid="([^"]+)"/)?.[1] ?? "my-svg"}-`;
	const clusterPattern = new RegExp(
		`<g class="cluster\\b[^"]*" id="([^"]+)"[^>]*>\\s*<rect\\b[^>]*?\\sx="${N}" y="${N}" width="${N}" height="${N}"[^>]*>\\s*<g class="cluster-label" transform="translate\\(${N},\\s*${N}\\)">(?:<foreignObject\\b[^>]*?\\sheight="${N}")?`,
		"g",
	);
	const clusters = [...svg.matchAll(clusterPattern)].map(
		([, svgId, x, y, width, height, labelX, labelY, labelHeight]) => ({
			id: svgId.startsWith(prefix) ? svgId.slice(prefix.length) : svgId,
			x: Number(x),
			y: Number(y),
			width: Number(width),
			height: Number(height),
			labelX: Number(labelX),
			labelY: Number(labelY),
			// undefined when mermaid drew the title without a box (htmlLabels: false); 0 for a group titled " ".
			labelHeight: labelHeight === undefined ? undefined : Number(labelHeight),
		}),
	);
	// A node is a group with a class of mermaid's node shapes or an id of a flowchart node; only image nodes are measured.
	const starts = [
		...svg.matchAll(/<g class="([^"]*)" id="([^"]+)"[^>]*>/g),
	].filter(
		([, cls, id]) =>
			/^(?:image-shape|node)\b/.test(cls) || id.includes("-flowchart-"),
	);
	const nodes = starts.map((start, i) => {
		const [cx, cy] = start[0].match(TRANSLATE)?.slice(1).map(Number) ?? [0, 0];
		if (!/^image-shape\b/.test(start[1])) return { cx, cy };
		const body = svg.slice(start.index, starts[i + 1]?.index ?? svg.length);
		const image = body.match(
			new RegExp(
				`<image href="data:image/svg\\+xml;base64,([^"]+)" width="${N}" height="${N}"[^>]*?${TRANSLATE.source}`,
			),
		);
		if (!image) return { cx, cy };
		const [, base64, , imageHeight, , imageY] = image;
		const top = cy + Number(imageY);
		const height = Number(imageHeight);
		// A tile padded by alignImageNodes draws its 60 units in a viewBox that starts above or ends below them.
		const viewBox = Buffer.from(base64, "base64")
			.toString("utf8")
			.match(new RegExp(`^<svg [^>]*viewBox="0 ${N} ${TILE} ${N}"`));
		const [from, span] = viewBox
			? [-Number(viewBox[1]), Number(viewBox[2])]
			: [0, TILE];
		const label = body.match(
			new RegExp(
				`<g class="label"[^>]*?${TRANSLATE.source}><rect/><foreignObject [^>]*?height="${N}"`,
			),
		);
		const shown = [
			top + (height * from) / span,
			top + (height * (from + TILE)) / span,
		];
		if (label)
			shown.push(
				cy + Number(label[2]),
				cy + Number(label[2]) + Number(label[3]),
			);
		return {
			cx,
			cy,
			imageTop: top,
			top: Math.min(...shown),
			bottom: Math.max(...shown),
		};
	});
	const edges = [
		...svg.matchAll(
			/<path\b[^>]*?\sdata-id="([^"]+)"[^>]*?\sdata-points="([A-Za-z0-9+/=]+)"/g,
		),
	].map(([, id, points]) => ({
		id,
		points: JSON.parse(Buffer.from(points, "base64").toString("utf8")),
	}));
	const labelPattern = new RegExp(
		`<g class="edgeLabel" ${TRANSLATE.source}><g class="label"[^>]*?${TRANSLATE.source}><foreignObject width="${N}" height="${N}"`,
		"g",
	);
	const labels = [...svg.matchAll(labelPattern)]
		.filter(([, , , , , width]) => Number(width) > 0)
		.map(([, cx, cy, , dy, , height]) => ({
			cx: Number(cx),
			top: Number(cy) + Number(dy),
			height: Number(height),
		}))
		.map(({ cx, top, height }) => ({
			cx,
			cy: top + height / 2,
			top,
			bottom: top + height,
		}));
	return { clusters, nodes, edges, labels };
}

// An edge's segments. mermaid lists points that lie on a straight run between two bends too; they are dropped, so a
// crossing at one of them is not taken for a meeting at a segment's end.
function segmentsOf(edge) {
	const turns = edge.points.filter((p, i, all) => {
		const [before, after] = [all[i - 1], all[i + 1]];
		if (!before || !after) return true;
		return (
			Math.abs(
				(p.x - before.x) * (after.y - p.y) - (p.y - before.y) * (after.x - p.x),
			) > 0.01
		);
	});
	return turns.slice(1).map((p, i) => ({ id: edge.id, a: turns[i], b: p }));
}

// The vertical extent of the part of a segment inside a rectangle (Liang–Barsky), or undefined if none of it is.
function clipY({ a, b }, box) {
	const [dx, dy] = [b.x - a.x, b.y - a.y];
	let [from, to] = [0, 1];
	for (const [step, room] of [
		[-dx, a.x - box.x],
		[dx, box.x + box.width - a.x],
		[-dy, a.y - box.y],
		[dy, box.y + box.height - a.y],
	]) {
		if (step === 0) {
			if (room < 0) return undefined;
			continue;
		}
		const t = room / step;
		if (step < 0) from = Math.max(from, t);
		else to = Math.min(to, t);
		if (from > to) return undefined;
	}
	const [y1, y2] = [a.y + from * dy, a.y + to * dy];
	return [Math.min(y1, y2), Math.max(y1, y2)];
}

// alignImageNodes pads each tile with empty space as tall as its label, so a group's frame, which mermaid fits around
// its nodes' boxes, starts that far above the topmost tile, under a title that holds the top left. Each frame is cut
// back to its title and FRAME_GAP above the topmost thing drawn inside it, and to FRAME_GAP below the lowest one,
// innermost groups first. A group holding a node other than an image node keeps its frame: its shape is not measured.
function tightenFrames({ clusters, nodes, edges, labels }) {
	const frames = new Map();
	const byArea = [...clusters].sort(
		(a, b) => a.width * a.height - b.width * b.height,
	);
	for (const group of byArea) {
		const holds = (x, y) =>
			x >= group.x &&
			x <= group.x + group.width &&
			y >= group.y &&
			y <= group.y + group.height;
		const held = nodes.filter((node) => holds(node.cx, node.cy));
		const inner = byArea.filter(
			(other) =>
				frames.has(other.id) && other !== group && holds(other.x, other.y),
		);
		const spans = [
			...held.map((node) => [node.top, node.bottom]),
			...inner.map((other) => [
				frames.get(other.id).top,
				frames.get(other.id).bottom,
			]),
			...edges.flatMap((edge) =>
				segmentsOf(edge)
					.map((segment) => clipY(segment, group))
					.filter(Boolean),
			),
			...labels
				.filter((label) => holds(label.cx, label.cy))
				.map((label) => [label.top, label.bottom]),
		];
		const bottom = group.y + group.height;
		const measured =
			spans.length > 0 &&
			group.labelHeight !== undefined &&
			held.every((node) => node.top !== undefined);
		frames.set(group.id, {
			top: measured
				? Math.max(
						group.y,
						Math.min(...spans.map((s) => s[0])) -
							FRAME_GAP -
							group.labelHeight -
							TITLE_INSET.y,
					)
				: group.y,
			bottom: measured
				? Math.min(bottom, Math.max(...spans.map((s) => s[1])) + FRAME_GAP)
				: bottom,
		});
	}
	return frames;
}

// Reads where mermaid put each group and its title in an SVG it drew, and returns the CSS that cuts each frame back to
// its contents (tightenFrames) and moves each title's box to the frame's top left, by an offset from where mermaid put
// it, so a page that lays the diagram out the same way (GitHub runs the same mermaid) places it the same; also the ids
// of the groups it found. The space the frames give up at the top of the diagram goes too: the diagram title moves
// down by it, and mermaid fits the picture to what it draws, CSS transforms included. The rules hold no ">", "<" or
// "url(data:", because mermaid empties a diagram's own themeCSS that does (the portable block carries it in the
// frontmatter), and no element name that mermaid would lowercase (SVG_TEXT_CSS).
export function groupLayoutCss(svg) {
	const layout = readLayout(svg);
	const frames = tightenFrames(layout);
	const rules = new Map();
	for (const group of layout.clusters) {
		const { top, bottom } = frames.get(group.id);
		const shift = round2(top - group.y);
		const scale = Number(((bottom - top) / group.height).toFixed(4));
		const frame =
			shift === 0 && scale === 1
				? "transform: none;"
				: `transform-box: fill-box; transform-origin: 0 0; transform: translateY(${shift}px) scaleY(${scale}); vector-effect: non-scaling-stroke;`;
		const dx = round2(group.x + TITLE_INSET.x - group.labelX);
		const dy = round2(top + TITLE_INSET.y - group.labelY);
		rules.set(group.id, [
			`.cluster[id$='-${group.id}'] rect[x] { ${frame} }`,
			`.cluster[id$='-${group.id}'] .cluster-label [height] { transform: translate(${dx}px, ${dy}px); }`,
		]);
	}
	const ids = [...rules.keys()].sort(byLength);
	const css = ids.flatMap((id) => rules.get(id));
	// mermaid puts the diagram title above the top of the layout, which the empty space of the topmost tiles and the
	// frames' old tops set. The title moves down to stand as far above the topmost thing drawn, so neither leaves a band
	// under it. Other nodes are measured by center only, so with any of them the top of the drawing is not known.
	if (layout.nodes.every((node) => node.imageTop !== undefined)) {
		const lines = layout.edges.flatMap((edge) => edge.points.map((p) => p.y));
		const labels = layout.labels.map((label) => label.top);
		const laidOut = Math.min(
			...layout.clusters.map((group) => group.y),
			...layout.nodes.map((node) => node.imageTop),
			...lines,
			...labels,
		);
		const drawn = Math.min(
			...layout.clusters.map((group) => frames.get(group.id).top),
			...layout.nodes.map((node) => node.top),
			...lines,
			...labels,
		);
		const freed = round2(drawn - laidOut);
		if (freed > 0)
			css.push(`.flowchartTitleText { transform: translateY(${freed}px); }`);
	}
	return { css: css.join("\n"), found: new Set(ids) };
}

// Two edges cross where a segment of one passes through a segment of the other, both away from their ends. Merged
// edges share their segments, and an edge that leaves a shared one only touches it, so neither counts. Edges that
// share a segment through one crossing make one crossing, not one per edge.
function parallel(u, v) {
	const [ux, uy, vx, vy] = [
		u.b.x - u.a.x,
		u.b.y - u.a.y,
		v.b.x - v.a.x,
		v.b.y - v.a.y,
	];
	return (
		Math.abs(ux * vy - uy * vx) < 0.1 * Math.hypot(ux, uy) * Math.hypot(vx, vy)
	);
}

// Two edges that leave one point side by side (a state diagram's start) can overlap by a pixel or two at a bend,
// which is not a crossing anyone sees.
const NEAR_END = 3;

export function countCrossings(svg) {
	const { edges } = readLayout(svg);
	const segments = edges.flatMap(segmentsOf);
	const side = (p, q, r) =>
		(q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
	const EPSILON = 0.01;
	const crossings = new Map();
	for (const [i, s] of segments.entries()) {
		for (const t of segments.slice(i + 1)) {
			if (s.id === t.id) continue;
			const [d1, d2, d3, d4] = [
				side(t.a, t.b, s.a),
				side(t.a, t.b, s.b),
				side(s.a, s.b, t.a),
				side(s.a, s.b, t.b),
			];
			if (!(d1 * d2 < -EPSILON && d3 * d4 < -EPSILON)) continue;
			const share = d1 / (d1 - d2);
			const at = {
				x: s.a.x + share * (s.b.x - s.a.x),
				y: s.a.y + share * (s.b.y - s.a.y),
			};
			if (
				[s.a, s.b, t.a, t.b].some(
					(end) => Math.hypot(end.x - at.x, end.y - at.y) < NEAR_END,
				)
			)
				continue;
			const [x, y] = [Math.round(at.x), Math.round(at.y)];
			const key = `${x},${y}`;
			if (!crossings.has(key))
				crossings.set(key, { x, y, ref: s, lines: [new Set(), new Set()] });
			// Two lines cross at a point, and merged edges run along one of them: an edge goes with the line it is parallel to.
			const crossing = crossings.get(key);
			for (const u of [s, t])
				crossing.lines[parallel(u, crossing.ref) ? 0 : 1].add(u.id);
		}
	}
	return [...crossings.values()].map(({ x, y, lines }) => ({
		x,
		y,
		lines: lines.map((ids) => [...ids].sort()),
	}));
}

// Puts css on the frontmatter's one-line themeCSS, which replaces any themeCSS the diagram had, and the font the labels
// were measured in, unless the diagram names its own: a page's default font ("trebuchet ms", verdana, arial; on Linux
// often a wider fallback) wraps a name that fits in Arial onto a line its box cuts off.
function withPortableConfig(text, css) {
	const frontmatter = text.match(/^---\n([\s\S]*?)\n---/);
	if (/^\s+themeCSS:\s*[|>]/m.test(frontmatter?.[1] ?? "")) {
		throw new Error("write the frontmatter themeCSS on one quoted line");
	}
	const lines = [
		`  themeCSS: "${css.replace(/"/g, "'").replace(/\s*\n\s*/g, " ")}"`,
	];
	if (!/^\s+fontFamily:/m.test(frontmatter?.[1] ?? ""))
		lines.push(`  fontFamily: '${FONT_FAMILY}'`);
	const added = lines.join("\n");
	if (!frontmatter) return `---\nconfig:\n${added}\n---\n${text}`;
	const body = frontmatter[1].replace(/^\s+themeCSS:.*(\n|$)/m, "");
	const config = /^config:\s*$/m;
	const merged = config.test(body)
		? body.replace(config, () => `config:\n${added}`)
		: `${body}\nconfig:\n${added}`;
	return `---\n${merged}\n---${text.slice(frontmatter[0].length)}`;
}

// GitHub's mermaid drops <small> from labels but keeps <span style>, and a role line at full size wraps past its box.
// The attribute is unquoted so it fits in a label quoted either way.
function withGithubSafeTags(text) {
	return text
		.replace(/<small\b[^>]*>/g, "<span style=font-size:smaller>")
		.replace(/<\/small>/g, "</span>");
}

// The diagram as one ```mermaid block for pages that run mermaid themselves: logos inline as data URIs (text must
// already be through inlineIcons and alignImageNodes), the label rules and the font in the frontmatter. Of the rules
// render.mjs passes mermaid-cli, IMAGE_LABEL_CSS is left out: portableCss decides which names keep their box. Returns
// undefined when the block is longer than mermaid's maxTextSize; throws on a block-style themeCSS, whose rules
// diagramThemeCss cannot read.
export function portableMarkdown(text, name, titleCss = "") {
	const css = [
		portableCss(text),
		SVG_TEXT_CSS,
		titleCss,
		groupEdgeLabelCss(text),
		diagramThemeCss(text),
	]
		.filter(Boolean)
		.join("\n");
	const block = withPortableConfig(withGithubSafeTags(text), css);
	if (block.length > PORTABLE_MAX_CHARS) return undefined;
	const note = `<!-- ${name}.mmd as drawn by render.mjs --portable, logos inside. Edit the .mmd and run it again. -->`;
	return `${note}\n\n\`\`\`mermaid\n${block.trimEnd()}\n\`\`\`\n`;
}

// The diagram types whose edges mermaid draws with their points (data-points), which countCrossings reads.
const HAS_EDGES = /^\s*(?:flowchart|graph|stateDiagram(?:-v2)?|erDiagram)\b/m;

// Names each crossing's edges by the source's `from --> to` (mermaid's data-id L_<from>_<to>_<n>), so the agent can
// find them in the .mmd; an edge the source parse misses keeps its data-id.
export function crossingReport(file, crossings, text) {
	if (crossings.length === 0) return `     ${file}: 0 edge crossings`;
	const names = new Map();
	const seen = new Map();
	for (const [from, to] of readGroups(text).edges) {
		const pair = `${from}_${to}`;
		const earlier = seen.get(pair) ?? 0;
		seen.set(pair, earlier + 1);
		names.set(
			`L_${pair}_${earlier === 0 ? 0 : earlier + 1}`,
			`${from} → ${to}`,
		);
	}
	// A state diagram numbers its transitions edge0, edge1, … in the order they are written.
	const transitions = [...text.matchAll(/^\s*(\S+)\s*-->\s*([^\s:]+)/gm)];
	for (const [n, [, from, to]] of transitions.entries())
		names.set(`edge${n}`, `${from} → ${to}`);
	// An ER diagram names a relation id_entity-<a>-<n>_entity-<b>-<n>_<n>.
	const relation = (id) =>
		id
			.match(/^id_entity-(.+)-\d+_entity-(.+)-\d+_\d+$/)
			?.slice(1)
			.join(" — ");
	const name = (ids) =>
		ids.map((id) => names.get(id) ?? relation(id) ?? id).join(" + ");
	const where = crossings.map(
		(c) => `${name(c.lines[0])} × ${name(c.lines[1])}`,
	);
	const count =
		crossings.length === 1
			? "1 edge crossing"
			: `${crossings.length} edge crossings`;
	return `     ${file}: ${count}: ${where.join("; ")}`;
}

// Colors are swapped token by token in one pass, so a light color that is also a dark value is not swapped twice.
// Only a block-style `theme:` line (frontmatter `config.theme`) is switched; `%%{init}%%` directives are not.
export function toDark(text) {
	const swapped = text.replace(
		/#[0-9a-fA-F]{6}\b/g,
		(hex) => DARK_COLORS[hex.toLowerCase()] ?? hex,
	);
	return /^\s+theme:\s*\S+/m.test(swapped)
		? swapped.replace(/^(\s+theme:\s*)\S+/m, "$1dark")
		: swapped;
}

const OPTIONS = {
	"--icons-dir": "icons",
	"--out": "out",
	"--theme": "theme",
	"--scale": "scale",
};

function parseArgs(argv) {
	const args = {
		files: [],
		icons: defaultIconsDir(),
		fetch: true,
		out: undefined,
		theme: "both",
		scale: "2",
	};
	let valid = true;
	for (let i = 0; i < argv.length; i++) {
		const flag = argv[i];
		if (flag === "--help") args.help = true;
		else if (flag === "--no-fetch") args.fetch = false;
		else if (flag === "--svg") args.svg = true;
		else if (flag === "--portable") args.portable = true;
		else if (OPTIONS[flag]) {
			const value = argv[++i];
			if (value === undefined || value.startsWith("--")) valid = false;
			else args[OPTIONS[flag]] = value;
		} else if (flag.startsWith("--")) valid = false;
		else args.files.push(flag);
	}
	if (
		!["both", "light", "dark"].includes(args.theme) ||
		!(Number(args.scale) > 0)
	)
		valid = false;
	if (args.help || !valid || args.files.length === 0) {
		(args.help ? console.log : console.error)(
			"usage: render.mjs <file.mmd>... [--icons-dir <dir>] [--no-fetch] [--out <dir>] [--theme both|light|dark] [--scale <n>] [--svg] [--portable]",
		);
		process.exit(args.help ? 0 : 2);
	}
	return args;
}

function mmdc(input, output, theme, configFile, scale) {
	const [command, ...prefix] = process.env.MMDC
		? [process.env.MMDC]
		: ["npx", "-y", MERMAID_CLI];
	const puppeteer = process.env.MERMAID_PUPPETEER_CONFIG
		? ["-p", process.env.MERMAID_PUPPETEER_CONFIG]
		: [];
	// -t only applies when the file has no theme of its own in its frontmatter.
	const args = [
		"-q",
		"-i",
		input,
		"-o",
		output,
		"-s",
		scale,
		"-b",
		BACKGROUND[theme],
		"-c",
		configFile,
	];
	// Gantt times carry no offset and are read in the browser's zone; in UTC a daylight-saving change cannot move them.
	const result = spawnSync(
		command,
		[
			...prefix,
			...args,
			"-t",
			theme === "dark" ? "dark" : "neutral",
			...puppeteer,
		],
		{
			encoding: "utf8",
			timeout: RENDER_TIMEOUT_MS,
			env: { ...process.env, TZ: "UTC" },
		},
	);
	if (result.status === 0) return undefined;
	const message = result.stderr || result.stdout || String(result.error);
	return message
		.split("\n")
		.filter((line) => !/^\s+at /.test(line))
		.join("\n")
		.trim();
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const work = mkdtempSync(join(tmpdir(), "render-"));
	const themeCSS = {
		light: `${IMAGE_LABEL_CSS}\n${SVG_TEXT_CSS}`,
		dark: `${IMAGE_LABEL_CSS}\n${SVG_TEXT_CSS}\n${DARK_EDGE_LABEL_CSS}`,
	};
	const themes = args.theme === "both" ? ["light", "dark"] : [args.theme];
	if (args.out) mkdirSync(args.out, { recursive: true });
	let failures = 0;
	try {
		for (const file of args.files) {
			let source;
			try {
				source = readFileSync(file, "utf8");
			} catch (error) {
				console.error(`fail ${file}: ${error.message}`);
				failures++;
				continue;
			}
			// mermaid reads a frontmatter only on the first line; after a comment it fails with "Parse error on line 1".
			if (/^(?:[ \t]*(?:%%[^\n]*)?\n)+---[ \t]*\n/.test(source)) {
				console.error(
					`fail ${file}: the frontmatter (---) must be on the first line. Move the %% lines below the diagram type line`,
				);
				failures++;
				continue;
			}
			const dirs = [args.icons];
			let { text, missing, incomplete } = inlineIcons(source, dirs);
			if (missing.length > 0 && args.fetch) {
				await fetchIcons(missing, args.icons, { baseDir: dirname(file) });
				({ text, missing, incomplete } = inlineIcons(source, dirs));
			}
			if (missing.length > 0) {
				console.error(
					`fail ${file}: icons not found in ${dirs.join(" or ")}: ${missing.join(", ")}`,
				);
				failures++;
				continue;
			}
			if (incomplete.length > 0) {
				const fixes = incomplete
					.map((icon) => `icon:${icon.spec} -> icon:${icon.fetchedAs}`)
					.join(", ");
				console.error(
					`fail ${file}: write the full spec, or the diagram fails from an empty cache: ${fixes}`,
				);
				failures++;
				continue;
			}
			const lifted = liftTitleLogos(alignImageNodes(text));
			text = lifted.text;
			const name = basename(file).replace(/(\.src)?\.(mmd|txt)$/, "");
			const outDir = args.out ?? dirname(file);
			const writeInput = (theme) => {
				const input = join(work, `${name}.${theme}.mmd`);
				const themed = theme === "dark" ? toDark(text) : text;
				writeFileSync(input, themed);
				return {
					input,
					css: `${themeCSS[theme]}\n${groupEdgeLabelCss(themed)}\n${diagramThemeCss(themed)}`,
				};
			};
			const writeConfig = (theme, css) => {
				const config = join(work, `${name}.${theme}.json`);
				writeFileSync(
					config,
					JSON.stringify({
						maxTextSize: MAX_TEXT_SIZE,
						fontFamily: FONT_FAMILY,
						...NATURAL_WIDTH,
						themeCSS: css,
					}),
				);
				return config;
			};
			// A first render, with the title logos in, tells where mermaid puts each group and its title, and where edges
			// cross; the outputs then cut the frames back and move the titles' boxes by CSS, which leaves the layout as it was.
			let titleCss = titleLogoCss(lifted.groups, lifted.logos);
			if (lifted.groups.length > 0 || HAS_EDGES.test(text)) {
				const { input, css } = writeInput("light");
				const layout = join(work, `${name}.layout.svg`);
				const error = mmdc(
					input,
					layout,
					"light",
					writeConfig("light", `${css}\n${titleCss}`),
					"1",
				);
				if (error) {
					console.error(`fail ${file} (layout)\n${error}`);
					failures++;
					continue;
				}
				const drawn = readFileSync(layout, "utf8");
				const moved = groupLayoutCss(drawn);
				const lost = [...lifted.logos.keys()].filter(
					(id) => !moved.found.has(id),
				);
				if (lost.length > 0) {
					console.error(
						`fail ${file}: mermaid drew no group title for ${lost.join(", ")}, so its logo would be lost`,
					);
					failures++;
					continue;
				}
				titleCss = `${titleCss}\n${moved.css}`;
				console.log(crossingReport(file, countCrossings(drawn), text));
			}
			if (args.portable) {
				const output = join(outDir, `${name}.portable.md`);
				let markdown;
				try {
					markdown =
						portableMarkdown(text, name, titleCss) ??
						new Error(
							`over ${PORTABLE_MAX_CHARS} characters with the logos inside; split it`,
						);
				} catch (error) {
					markdown = error;
				}
				if (markdown instanceof Error) {
					console.error(`fail ${file} (portable): ${markdown.message}`);
					failures++;
				} else {
					writeFileSync(output, markdown);
					console.log(`ok   ${output}`);
				}
			}
			const formats = args.svg ? ["png", "svg"] : ["png"];
			for (const theme of themes) {
				const { input, css } = writeInput(theme);
				const config = writeConfig(theme, `${css}\n${titleCss}`);
				for (const format of formats) {
					const output = join(
						outDir,
						theme === "dark" ? `${name}.dark.${format}` : `${name}.${format}`,
					);
					const error = mmdc(input, output, theme, config, args.scale);
					if (error) {
						console.error(`fail ${file} (${theme} ${format})\n${error}`);
						failures++;
						continue;
					}
					console.log(`ok   ${output}`);
				}
			}
		}
	} finally {
		rmSync(work, { recursive: true, force: true });
	}
	process.exit(failures > 0 ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
