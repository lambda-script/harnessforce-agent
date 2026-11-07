// runはhookを読み込まないため、SessionStartが注入する本文をcaseのappend_system_promptへ写す。
// 引数のSKILL.md（mainの版との比較用）を与えなければ、このrepositoryのusing-harnessforceを写す。
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";

const here = fileURLToPath(new URL(".", import.meta.url));
const skillPath =
	process.argv[2] ?? join(here, "../../skills/using-harnessforce/SKILL.md");
const body = readFileSync(skillPath, "utf8")
	.replace(/\r\n/g, "\n")
	.replace(/^---\n[\s\S]*?\n---\n+/, "")
	.trimEnd();
const SESSION_ID_LINE = /^harnessforce agent_session_id: [^\n]+\n\n/;

for (const entry of readdirSync(here, { withFileTypes: true })) {
	if (!entry.isDirectory()) continue;
	const path = join(here, entry.name, "prompt.md");
	const [, frontmatter, prompt] = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(
		readFileSync(path, "utf8"),
	);
	const document = parseDocument(frontmatter);
	const line = SESSION_ID_LINE.exec(
		String(document.get("append_system_prompt") ?? ""),
	)?.[0];
	const text = document.createNode(`${line ?? ""}${body}\n`);
	text.type = "QUOTE_DOUBLE";
	document.set("append_system_prompt", text);
	// claude plugin eval（2.1.319）は値の中でも次の"---"でfrontmatterを終えるため、表の区切りをYAMLの\x2Dで書く。
	const yaml = document
		.toString({ lineWidth: 0, flowCollectionPadding: false })
		.replaceAll("---", "\\x2D\\x2D\\x2D");
	writeFileSync(path, `---\n${yaml}---\n${prompt}`);
}
