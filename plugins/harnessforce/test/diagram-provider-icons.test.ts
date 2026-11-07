import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, it } from "vitest";
import { fetchIcons } from "../skills/diagram/scripts/fetch-icons.mjs";
import {
	providerOf,
	readZip,
	resolveProviderIcon,
} from "../skills/diagram/scripts/provider-icons.mjs";

const fixture = (name: string) =>
	readFileSync(new URL(`fixtures/diagram/${name}`, import.meta.url));
// Each fixture holds a few entries named as in the provider's real package, with data descriptors as the real ones.
const PACKAGES = {
	aws: [
		{
			url: "https://example.test/aws.zip",
			entries: readZip(fixture("aws-icons.zip")),
		},
	],
	gcp: [
		{
			url: "https://example.test/gcp.zip",
			entries: readZip(fixture("gcp-icons.zip")),
		},
	],
	azure: [
		{
			url: "https://example.test/azure.zip",
			entries: readZip(fixture("azure-icons.zip")),
		},
	],
};
const loadPackages = async (provider: string) =>
	PACKAGES[provider as keyof typeof PACKAGES];
const titleOf = (icon: { read: () => Buffer }) =>
	icon
		.read()
		.toString("utf8")
		.match(/<title>(.*)<\/title>/)?.[1];

const work = mkdtempSync(join(tmpdir(), "provider-icons-test-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));

it("readZip reads deflated and stored entries of a zip written with data descriptors", () => {
	const entries = readZip(fixture("aws-icons.zip"));
	const fargate =
		"Architecture-Service-Icons_01/Arch_Containers/64/Arch_AWS-Fargate_64.svg";
	const s3 =
		"Architecture-Service-Icons_01/Arch_Storage/64/Arch_Amazon-Simple-Storage-Service_64.svg";
	assert.equal(entries.size, 5);
	assert.match(
		entries.get(fargate)().toString("utf8"),
		/<title>fargate<\/title>/,
	);
	assert.match(entries.get(s3)().toString("utf8"), /<title>s3<\/title>/);
});

it("providerOf routes provider slugs and leaves brand slugs to the logo sources", () => {
	assert.deepEqual(providerOf("aws/fargate"), {
		provider: "aws",
		query: "fargate",
	});
	assert.deepEqual(providerOf("aws-lambda"), {
		provider: "aws",
		query: "lambda",
	});
	assert.deepEqual(providerOf("aws"), {
		provider: "aws",
		query: "AWS-Cloud-logo",
	});
	assert.deepEqual(providerOf("gcp/cloud-sql"), {
		provider: "gcp",
		query: "cloud-sql",
	});
	assert.deepEqual(providerOf("google-cloud-run"), {
		provider: "gcp",
		query: "run",
	});
	assert.deepEqual(providerOf("azure/redis"), {
		provider: "azure",
		query: "redis",
	});
	assert.deepEqual(providerOf("Azure"), {
		provider: "azure",
		query: "Azure-A",
	});
	assert.equal(providerOf("neon"), undefined);
	assert.equal(providerOf("google-cloud"), undefined);
});

it("resolveProviderIcon finds AWS icons by name, acronym or without the AWS-/Amazon- prefix, at 64 px", async () => {
	assert.equal(
		titleOf(await resolveProviderIcon("aws", "fargate", loadPackages)),
		"fargate",
	);
	assert.equal(
		titleOf(await resolveProviderIcon("aws", "s3", loadPackages)),
		"s3",
	);
	assert.equal(
		titleOf(await resolveProviderIcon("aws", "General-User", loadPackages)),
		"user",
	);
	assert.equal(
		titleOf(await resolveProviderIcon("aws", "AWS-Cloud-logo", loadPackages)),
		"cloud",
	);
	const fargate = await resolveProviderIcon("aws", "AWS-Fargate", loadPackages);
	assert.equal(
		fargate.url,
		"https://example.test/aws.zip#Architecture-Service-Icons_01/Arch_Containers/64/Arch_AWS-Fargate_64.svg",
	);
});

it("resolveProviderIcon gives a Google Cloud product its own icon or its category's icon", async () => {
	assert.equal(
		titleOf(await resolveProviderIcon("gcp", "gke", loadPackages)),
		"gke",
	);
	assert.equal(
		titleOf(await resolveProviderIcon("gcp", "cloud-sql", loadPackages)),
		"sql",
	);
	assert.equal(
		titleOf(await resolveProviderIcon("gcp", "gcs", loadPackages)),
		"gcs",
	);
	assert.equal(
		titleOf(await resolveProviderIcon("gcp", "memorystore", loadPackages)),
		"databases",
	);
	assert.equal(
		titleOf(await resolveProviderIcon("gcp", "load-balancing", loadPackages)),
		"networking",
	);
	assert.equal(
		titleOf(await resolveProviderIcon("gcp", "vpc", loadPackages)),
		"networking",
	);
});

it("resolveProviderIcon matches a Google Cloud name without its Google or Cloud prefix", async () => {
	assert.equal(
		titleOf(await resolveProviderIcon("gcp", "sql", loadPackages)),
		"sql",
	);
	assert.equal(
		titleOf(await resolveProviderIcon("gcp", "storage", loadPackages)),
		"gcs",
	);
});

it("resolveProviderIcon finds Azure icons by name, short form, or without the prefix and plural s", async () => {
	assert.equal(
		titleOf(await resolveProviderIcon("azure", "app-service", loadPackages)),
		"app",
	);
	assert.equal(
		titleOf(await resolveProviderIcon("azure", "redis", loadPackages)),
		"redis",
	);
	assert.equal(
		titleOf(await resolveProviderIcon("azure", "front-door", loadPackages)),
		"frontdoor",
	);
	assert.equal(
		titleOf(
			await resolveProviderIcon("azure", "microsoft-app-service", loadPackages),
		),
		"app",
	);
	assert.equal(
		titleOf(
			await resolveProviderIcon(
				"azure",
				"azure-front-door-and-cdn-profile",
				loadPackages,
			),
		),
		"frontdoor",
	);
});

it("resolveProviderIcon lists every name on a miss instead of guessing a near match", async () => {
	await assert.rejects(
		resolveProviderIcon("aws", "lambda", loadPackages),
		(error: Error) => {
			assert.match(error.message, /'lambda' is not a name in the AWS package/);
			assert.match(
				error.message,
				/AWS-Fargate, AWS-Cloud-logo|AWS-Cloud-logo, AWS-Fargate/,
			);
			return true;
		},
	);
	await assert.rejects(
		resolveProviderIcon("gcp", "cloud-ghost", loadPackages),
		(error: Error) => {
			assert.match(
				error.message,
				/'cloud-ghost' is not a name in the Google Cloud package/,
			);
			assert.match(error.message, /\bCloud SQL\b/);
			assert.match(error.message, /\bMemorystore\b/);
			return true;
		},
	);
});

it("fetchIcons writes a provider icon from its package and records the package member as its source", async () => {
	const dir = join(work, "icons");
	const failed = await fetchIcons(
		["fargate:aws/fargate", "sql:gcp/cloud-sql", "ghost:aws/ghost"],
		dir,
		{
			loadPackages,
		},
	);
	assert.deepEqual(failed, ["ghost:aws/ghost"]);
	assert.match(
		readFileSync(join(dir, "fargate.svg"), "utf8"),
		/<title>fargate<\/title>/,
	);
	assert.ok(existsSync(join(dir, "sql.svg")));
	const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
	assert.equal(manifest.fargate.source, "aws");
	assert.equal(manifest.sql.source, "gcp");
	assert.match(
		manifest.sql.url,
		/^https:\/\/example\.test\/gcp\.zip#Unique Icons\/Cloud SQL\//,
	);
});

it("fetchIcons fails only the spec whose package member does not inflate", async () => {
	const dir = join(work, "broken");
	const entries = new Map([
		[
			"Unique Icons/GKE/SVG/GKE-512-color.svg",
			() => {
				throw new Error("invalid stored block lengths");
			},
		],
	]);
	const broken = async (provider: string) =>
		provider === "gcp"
			? [{ url: "https://example.test/gcp.zip", entries }]
			: PACKAGES[provider as keyof typeof PACKAGES];
	const failed = await fetchIcons(["gke:gcp/gke", "fargate:aws/fargate"], dir, {
		loadPackages: broken,
	});
	assert.deepEqual(failed, ["gke:gcp/gke"]);
	assert.ok(existsSync(join(dir, "fargate.svg")));
});
