// Reads AWS, Google Cloud and Azure service icons from each provider's official icon package (a zip). The packages
// are read in memory and never written to disk: the providers allow their icons in diagrams, but redistribution is not
// confirmed (references/cloud-providers.md).
import { inflateRawSync } from "node:zlib";

export const HEADERS = { "User-Agent": "harnessforce-diagram fetch-icons" };
// AWS's package is about 14 MB; on a slow link it needs more than the 15 s fetch-icons gives a logo.
const TIMEOUT_MS = 60_000;

const AWS_ICONS_PAGE = "https://aws.amazon.com/architecture/icons/";
const AWS_PACKAGE =
	/(?:https:)?\/\/[\w.-]+\.awsstatic\.com\/[^"'\s]+\/Icon-package_[^"'\s/]+\.zip/;
const AWS_ICON =
	/^(?:Architecture-Service-Icons_[^/]+\/[^/]+\/64\/Arch_(.+)_64\.svg|Architecture-Group-Icons_[^/]+\/(.+)_32\.svg|Resource-Icons_[^/]+\/Res_General-Icons\/Res_48_Light\/Res_(.+)_48_Light\.svg)$/;
// Short names people write for a service -> its name in the package. Names the package already has, with or without
// the AWS-/Amazon- prefix (ec2, lambda, fargate, cloudfront), need no entry.
const AWS_ALIASES = {
	alb: "Elastic-Load-Balancing",
	apigw: "Amazon-API-Gateway",
	ddb: "Amazon-DynamoDB",
	dynamo: "Amazon-DynamoDB",
	ecr: "Amazon-Elastic-Container-Registry",
	ecs: "Amazon-Elastic-Container-Service",
	eks: "Amazon-Elastic-Kubernetes-Service",
	elb: "Elastic-Load-Balancing",
	glacier: "Amazon-Simple-Storage-Service-Glacier",
	iam: "AWS-Identity-and-Access-Management",
	kms: "AWS-Key-Management-Service",
	msk: "Amazon-Managed-Streaming-for-Apache-Kafka",
	nlb: "Elastic-Load-Balancing",
	opensearch: "Amazon-OpenSearch-Service",
	s3: "Amazon-Simple-Storage-Service",
	ses: "Amazon-Simple-Email-Service",
	sns: "Amazon-Simple-Notification-Service",
	sqs: "Amazon-Simple-Queue-Service",
	vpc: "Virtual-private-cloud-VPC",
};

const GCP_PACKAGES = [
	"https://services.google.com/fh/files/misc/core-products-icons.zip",
	"https://services.google.com/fh/files/misc/category-icons.zip",
];
const GCP_ICON = /^(?:Unique|Category) Icons\/([^/]+)\/SVG\/[^/]+\.svg$/;
// Icon folder -> the products drawn with it, from Google's "Google Cloud product icons" guide (May 2026,
// https://services.google.com/fh/files/misc/google-cloud-product-icons.pdf, read 2026-11-07). Core products have a
// folder of their own and are found by name; listed here are only the other names of a core folder and every general
// product, which takes its category's icon. The guide lists Agent Assist and Customer Engagement Suite under two
// categories; they are under Agents here. Its bare "SQL" is left out, so gcp/sql finds Cloud SQL.
const GCP_PRODUCTS = {
	AlloyDB: ["AlloyDB Omni"],
	BigQuery: ["BigQuery Functions", "BigQuery Omni"],
	"Cloud Spanner": ["Spanner"],
	"Cloud Storage": ["GCS"],
	"Compute Engine": ["GCE"],
	"Distributed Cloud": ["Google Distributed Cloud"],
	GKE: ["Google Kubernetes Engine", "Kubernetes Engine"],
	Hyperdisk: ["Persistent Disk"],
	Looker: ["Looker Studio", "Looker Studio Pro"],
	"Security Operations": ["Google Security Operations", "SecOps"],
	"Threat Intelligence": ["Google Threat Intelligence"],

	Agents: [
		"AI Applications & Agents",
		"AI Testing agent",
		"Automotive AI agent",
		"Code Documentation agent",
		"Deep Research agent",
		"Food ordering AI agent",
		"Idea Generation agent",
		"Customer Engagement Suite",
		"Conversational Agents",
		"Agent Assist",
		"Conversational Insights",
		"Contact Center as a Service",
	],
	"AI _ Machine Learning": [
		"AI and Machine Learning",
		"Advanced Agent Modeling",
		"AI Hub",
		"AI Platform",
		"AI Platform Unified",
		"AutoML",
		"AutoML Natural Language",
		"AutoML Tables",
		"AutoML Translation",
		"AutoML Video Intelligence",
		"AutoML Vision",
		"Cloud GPU",
		"Cloud Healthcare API",
		"Cloud Natural Language API",
		"Cloud Optimization AI",
		"Cloud Optimization AI Fleet Routing API",
		"Cloud TPU",
		"Cloud Translation API",
		"Cloud Vision API",
		"Data Labeling",
		"Dialogflow ES",
		"Document AI",
		"Genomics",
		"Healthcare NLP API",
		"Media Translation API",
		"Recommendations AI",
		"Speech to Text",
		"Tensorflow Enterprise",
		"Text To Speech",
		"Visual Inspection AI",
	],
	Collaboration: ["Google Workspace"],
	Compute: [
		"Batch",
		"Container Optimized OS",
		"GCE Systems Management",
		"Migrate To Virtual Machines",
		"OS Config Management",
		"OS Inventory Management",
		"OS Patch Management",
		"VMware Engine",
	],
	Containers: ["Backup for GKE", "Knative serving", "Migrate To Containers"],
	"Data Analytics": [
		"Analytics Hub",
		"BigLake",
		"Cloud Composer",
		"Cloud Data Fusion",
		"Data Catalog",
		"Data Layers",
		"Data Loss Prevention API",
		"Dataflow",
		"Dataplex",
		"Datapol",
		"Dataprep",
		"Dataproc",
		"Dataproc Metastore",
		"Datashare",
		"Datastream",
		"Pub/Sub",
	],
	Databases: [
		"Bare Metal Solution",
		"Bigtable",
		"Database Center",
		"Database Migration Service",
		"Datastore",
		"Firestore",
		"Memorystore",
	],
	"Developer Tools": [
		"Cloud Code",
		"Cloud Deployment Manager",
		"Cloud Scheduler",
		"Cloud Shell",
		"Cloud Tasks",
		"Cloud Workstations",
		"Runtime Config",
		"Service Catalog",
		"Tools For Powershell",
	],
	DevOps: [
		"Artifact Registry",
		"Cloud Build",
		"Cloud Deploy",
		"Container Registry",
	],
	"Hybrid & Multicloud": ["Hybrid and Multicloud"],
	"Integration Services": [
		"Advanced API Security",
		"API Analytics",
		"Application Integration",
		"Cloud API Gateway",
		"Cloud APIs",
		"Cloud Endpoints",
		"Connectors",
		"Developer Portal",
		"Eventarc",
		"Workflows",
	],
	"Management Tools": ["Carbon Footprint", "Producer Portal"],
	"Maps & Geospatial": [
		"Maps and Geospatial",
		"Earth Engine",
		"Google Earth",
		"Google Maps Platform",
	],
	Marketplace: ["Google Cloud Marketplace"],
	Migration: ["Migrate For Compute Engine", "Transfer Appliance"],
	Networking: [
		"Cloud Armor",
		"Cloud CDN",
		"Cloud DNS",
		"Cloud Domains",
		"Cloud Firewall Rules",
		"Cloud IDS",
		"Cloud Interconnect",
		"Cloud Load Balancing",
		"Cloud NAT",
		"Cloud Network",
		"Cloud Router",
		"Cloud VPN",
		"Connectivity Test",
		"Data Transfer",
		"Network Connectivity Center",
		"Network Intelligence Center",
		"Network Security",
		"Network Tiers",
		"Network Topology",
		"Packet Mirroring",
		"Partner Interconnect",
		"Premium Network Tier",
		"Private Connectivity",
		"Private Service Connect",
		"Routes",
		"Service Mesh",
		"Virtual Private Cloud",
		"VPC",
	],
	Observability: [
		"Cloud Audit Logs",
		"Cloud Logging",
		"Cloud Monitoring",
		"Error Reporting",
		"Google Cloud Observability",
		"Profiler",
		"Trace",
	],
	Operations: [
		"App Hub",
		"Backup and DR",
		"Capacity Planner",
		"Performance Dashboard",
		"Personalized Service Health",
	],
	"Security Identity": [
		"Security and Identity",
		"Access Context Manager",
		"Asset Inventory",
		"Assured Workloads",
		"BeyondCorp",
		"Binary Authorization",
		"Certificate Authority Service",
		"Certificate Manager",
		"Cloud Asset Inventory",
		"Cloud External Key Manager",
		"Cloud HSM",
		"Cloud Security Scanner",
		"Identity and Access Management",
		"Identity Aware Proxy",
		"Identity Platform",
		"Key Access Justifications",
		"Key Management Service",
		"Managed Service For Microsoft Active Directory",
		"Phishing Protection",
		"Policy Analyzer",
		"Recaptcha Enterprise",
		"Risk Manager",
		"Secret Manager",
		"Security Key Enforcement",
		"Web Risk",
		"Web Security Scanner",
		"Workload Identity Federation",
	],
	"Serverless Computing": ["Serverless", "App Engine", "Cloud Functions"],
	Storage: [
		"Filestore",
		"Google Cloud NetApp Volumes",
		"Local SSD",
		"Parallelstore",
		"Storage Transfer Service",
	],
	"Web & Mobile": ["Web and Mobile"],
	Web3: ["Blockchain Node Engine", "Blockchain RPC"],
};

const AZURE_ICONS_PAGE =
	"https://learn.microsoft.com/en-us/azure/architecture/icons/";
const AZURE_PACKAGE =
	/https:\/\/arch-center\.azureedge\.net\/icons\/Azure_Public_Service_Icons_V\d+\.zip/;
const AZURE_ICON =
	/^Azure_Public_Service_Icons\/Icons\/[^/]+\/\d+\s*-icon-service-(.+)\.svg$/;
// Short names people write for a service -> its name in the package. Names the package already has, with or without
// the Azure-/Microsoft- prefix and a plural s (app-service, front-door, cosmos-db), need no entry.
const AZURE_ALIASES = {
	acr: "Container-Registries",
	aks: "Kubernetes-Services",
	apim: "API-Management-Services",
	appgateway: "Application-Gateways",
	appinsights: "Application-Insights",
	blob: "Storage-Accounts",
	blobstorage: "Storage-Accounts",
	containerapps: "Container-Apps-Environments",
	cosmos: "Azure-Cosmos-DB",
	frontdoor: "Front-Door-and-CDN-Profiles",
	functions: "Function-Apps",
	keyvault: "Key-Vaults",
	loganalytics: "Log-Analytics-Workspaces",
	postgres: "Azure-Database-PostgreSQL-Server",
	postgresql: "Azure-Database-PostgreSQL-Server",
	redis: "Azure-Managed-Redis",
	rg: "Resource-Groups",
	servicebus: "Azure-Service-Bus",
	sqldb: "SQL-Database",
	staticwebapps: "Static-Apps",
	vm: "Virtual-Machine",
	vnet: "Virtual-Networks",
	webapp: "App-Services",
};

const PROVIDER_NAMES = { aws: "AWS", gcp: "Google Cloud", azure: "Azure" };
export const normalize = (text) => text.toLowerCase().replace(/[^a-z0-9]/g, "");

// The end-of-central-directory record holds the directory's size and offset. The local headers of these packages
// are followed by data descriptors, so entry sizes are read from the central directory only.
export function readZip(buffer) {
	const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
	if (end < 0) throw new Error("not a zip file: no end of central directory");
	const count = buffer.readUInt16LE(end + 10);
	let at = buffer.readUInt32LE(end + 16);
	const entries = new Map();
	for (let i = 0; i < count; i++) {
		if (buffer.readUInt32LE(at) !== 0x02014b50)
			throw new Error("broken zip central directory");
		const method = buffer.readUInt16LE(at + 10);
		const compressedSize = buffer.readUInt32LE(at + 20);
		const nameLength = buffer.readUInt16LE(at + 28);
		const extraLength = buffer.readUInt16LE(at + 30);
		const commentLength = buffer.readUInt16LE(at + 32);
		const localHeader = buffer.readUInt32LE(at + 42);
		const name = buffer.toString("utf8", at + 46, at + 46 + nameLength);
		entries.set(name, () => {
			const start =
				localHeader +
				30 +
				buffer.readUInt16LE(localHeader + 26) +
				buffer.readUInt16LE(localHeader + 28);
			const data = buffer.subarray(start, start + compressedSize);
			if (method === 0) return Buffer.from(data);
			if (method === 8) return inflateRawSync(data);
			throw new Error(`${name}: unsupported zip compression method ${method}`);
		});
		at += 46 + nameLength + extraLength + commentLength;
	}
	return entries;
}

// Which provider package a slug names, and the query to look up in it; undefined for brand slugs.
export function providerOf(slug) {
	const flat = normalize(slug);
	if (flat === "aws" || flat === "amazonwebservices")
		return { provider: "aws", query: "AWS-Cloud-logo" };
	if (flat === "azure" || flat === "microsoftazure")
		return { provider: "azure", query: "Azure-A" };
	const aws = slug.match(/^aws[/-](.+)$/i);
	if (aws) return { provider: "aws", query: aws[1] };
	const azure = slug.match(/^azure[/-](.+)$/i);
	if (azure) return { provider: "azure", query: azure[1] };
	const gcp = slug.match(/^(?:gcp\/|gcp-|google-cloud-)(.+)$/i);
	if (gcp) return { provider: "gcp", query: gcp[1] };
	return undefined;
}

async function download(url) {
	const response = await fetch(url, {
		headers: HEADERS,
		signal: AbortSignal.timeout(TIMEOUT_MS),
	});
	if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
	return Buffer.from(await response.arrayBuffer());
}

// AWS and Microsoft publish each release under a new URL; their icon pages link the current one.
async function packageLinkedFrom(page, link) {
	const found = (await download(page)).toString("utf8").match(link);
	if (!found) throw new Error(`no icon package link on ${page}`);
	const url = new URL(found[0], page).href;
	return { url, entries: readZip(await download(url)) };
}

const loaded = new Map();

// Downloads a provider's packages once per process.
export function loadProviderPackages(provider) {
	if (!loaded.has(provider)) {
		const load = {
			aws: async () => [await packageLinkedFrom(AWS_ICONS_PAGE, AWS_PACKAGE)],
			azure: async () => [
				await packageLinkedFrom(AZURE_ICONS_PAGE, AZURE_PACKAGE),
			],
			gcp: () =>
				Promise.all(
					GCP_PACKAGES.map(async (url) => ({
						url,
						entries: readZip(await download(url)),
					})),
				),
		}[provider];
		loaded.set(provider, load());
	}
	return loaded.get(provider);
}

// {normalized name: {name, url, read}}. When several files share a name (sizes or variants of one icon in AWS's and
// Azure's packages), the first in sorted order is kept, so a lookup does not depend on the zip's order. Google's
// packages hold one file per folder (core-products-icons.zip and category-icons.zip, checked 2026-11-07).
function indexPackages(packages, { pattern, nameOf }) {
	const index = new Map();
	for (const { url, entries } of packages) {
		const members = [...entries.keys()].sort();
		for (const member of members) {
			const match = member.match(pattern);
			if (!match) continue;
			const name = nameOf(match);
			const key = normalize(name);
			if (!index.has(key))
				index.set(key, {
					name,
					url: `${url}#${member}`,
					read: entries.get(member),
				});
		}
	}
	return index;
}

function lookupAws(index, query) {
	const wanted = normalize(AWS_ALIASES[normalize(query)] ?? query);
	return (
		index.get(wanted) ??
		[...index].find(([key]) => key.replace(/^(aws|amazon)/, "") === wanted)?.[1]
	);
}

function lookupGcp(index, query) {
	const iconOf = new Map([...index.keys()].map((key) => [key, key]));
	for (const [icon, products] of Object.entries(GCP_PRODUCTS))
		for (const product of products)
			iconOf.set(normalize(product), normalize(icon));
	const wanted = normalize(query);
	const icon =
		iconOf.get(wanted) ??
		[...iconOf].find(
			([key]) => key.replace(/^(google|cloud)+/, "") === wanted,
		)?.[1];
	return icon === undefined ? undefined : index.get(icon);
}

function lookupAzure(index, query) {
	const short = (key) => key.replace(/^(azure|microsoft)|s$/g, "");
	const wanted = normalize(AZURE_ALIASES[normalize(query)] ?? query);
	return (
		index.get(wanted) ??
		[...index].find(([key]) => short(key) === short(wanted))?.[1]
	);
}

const gcpProductNames = () => Object.values(GCP_PRODUCTS).flat();

const PROVIDERS = {
	aws: {
		pattern: AWS_ICON,
		nameOf: (m) => m[1] ?? m[2] ?? `General-${m[3]}`,
		lookup: lookupAws,
	},
	gcp: {
		pattern: GCP_ICON,
		nameOf: (m) => m[1],
		lookup: lookupGcp,
		extraNames: gcpProductNames,
	},
	azure: {
		pattern: AZURE_ICON,
		nameOf: (m) => m[1].trim(),
		lookup: lookupAzure,
	},
};

// Exact matches only, after the provider's aliases and optional prefixes: a partial match could ship the wrong
// service's icon. A miss throws with every name in the package and, for Google Cloud, every product name.
export async function resolveProviderIcon(
	provider,
	query,
	loadPackages = loadProviderPackages,
) {
	const config = PROVIDERS[provider];
	const { lookup, extraNames = () => [] } = config;
	const index = indexPackages(await loadPackages(provider), config);
	const hit = lookup(index, query);
	if (hit) return hit;
	const names = [
		...new Set([
			...[...index.values()].map((entry) => entry.name),
			...extraNames(),
		]),
	].sort((a, b) => a.localeCompare(b));
	throw new Error(
		`'${query}' is not a name in the ${PROVIDER_NAMES[provider]} package. Names: ${names.join(", ")}`,
	);
}
