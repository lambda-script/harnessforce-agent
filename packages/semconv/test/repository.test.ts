import { describe, expect, it } from "vitest";
import * as semconv from "../src/index.js";
import { normalizeRepository } from "../src/repository.js";
import { RepositorySlug } from "../src/schemas/common.js";
import { compile } from "./support/validator.js";

const isSlug = compile(RepositorySlug);

describe("normalizeRepository", () => {
	it.each([
		["https://github.com/acme/web.git", "github.com/acme/web"],
		["https://github.com/acme/web/", "github.com/acme/web"],
		["https://github.com/acme/web.git/", "github.com/acme/web"],
		[
			"https://x-access-token:secret@GitHub.com/Acme/Web.git",
			"github.com/acme/web",
		],
		["git@github.com:Acme/Web.git", "github.com/acme/web"],
		["ssh://git@ssh.github.com:443/Acme/Web.git", "github.com/acme/web"],
		["git://github.com/acme/web", "github.com/acme/web"],
		[
			"https://GitLab.Example.com:8443/Team/App.git",
			"gitlab.example.com/Team/App",
		],
		["git@work-github:acme/web.git", "work-github/acme/web"],
		["  https://github.com/acme/web\n", "github.com/acme/web"],
	])("%s -> %s", (remote, expected) => {
		const normalized = normalizeRepository(remote);
		expect(normalized).toBe(expected);
		expect(isSlug(normalized)).toBe(true);
	});

	it.each([
		"",
		"not a url",
		"../web",
		"/srv/git/web.git",
		"file:///srv/git/web.git",
		"C:/srv/git/web.git",
		"https://gitlab.com/group/sub/app.git",
		"https://github.com/acme",
		"https://[::1]/acme/web.git",
	])("returns undefined for %j", (remote) =>
		expect(normalizeRepository(remote)).toBeUndefined());

	it("is exported from the public entry", () =>
		expect(semconv.normalizeRepository).toBe(normalizeRepository));
});
