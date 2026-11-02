import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { REQUIRED_CLI_VERSION } from "../src/required-cli-version.js";

// onboarding.md「setupの手順」の手順2、3と、client-updates.md「pluginが必要とするCLIの版」。
describe("/harnessforce:setup and the CLI version the plugin needs", () => {
	// Windowsのcheckoutは改行をCRLFへ変えるため、LFへ揃える。
	const body = readFileSync(
		new URL("../commands/setup.md", import.meta.url),
		"utf8",
	).replaceAll("\r\n", "\n");
	const section = (heading: string) => {
		const start = body.indexOf(heading);
		return body.slice(start, body.indexOf("\n## ", start + heading.length));
	};

	it("names the same version as the hook", () => {
		const named = [...body.matchAll(/CLI (\d+\.\d+\.\d+)/g)].map(
			(match) => match[1],
		);
		expect(named.length).toBeGreaterThan(0);
		expect(new Set(named)).toEqual(new Set([REQUIRED_CLI_VERSION]));
	});

	it("shows the update line without updating the CLI and stops at step 3", () => {
		const check = section("### CLI version this plugin needs");
		expect(check).toContain(
			`Harnessforce plugin needs CLI ${REQUIRED_CLI_VERSION} or later, but CLI <installed> is installed. Update it: \`npm install -g @harnessforce/cli@latest\``,
		);
		expect(check).toMatch(/do not update the CLI/);
		expect(check).toMatch(/stop at step 3/);
	});

	it("checks in step 3 when the CLI is already installed, and in step 2 before going to step 9", () => {
		for (const step of [
			"## 2. Check whether this run is after the restart",
			"## 3. Install the CLI",
		])
			expect(section(step)).toContain('"CLI version this plugin needs"');
		expect(body.indexOf("### CLI version this plugin needs")).toBeGreaterThan(
			body.indexOf("## 3. Install the CLI"),
		);
	});
});
