import { type Static, Type } from "@sinclair/typebox";
import { Agent, closed, Sha256Hex, schemaId, Token } from "./common.js";

export const COMPONENT_KINDS = [
	"skill",
	"rule",
	"agent",
	"command",
	"hook",
	"permissions",
	"mcp_server",
	"model",
	"workflow",
] as const;
// Claude Codeのsettingsのscopeに対応する収集元（managed/user/repository/local）とplugin。
export const CONFIG_SOURCES = [
	"managed",
	"user",
	"repository",
	"local",
	"plugin",
] as const;

const Component = Type.Object(
	{
		kind: Type.Union(COMPONENT_KINDS.map((k) => Type.Literal(k))),
		id: Token(),
		// permissionsやmodelはversionを持たないため任意とする。
		version: Type.Optional(Token(64)),
		hash: Sha256Hex,
		source: Type.Union(CONFIG_SOURCES.map((s) => Type.Literal(s))),
	},
	closed,
);

export const ConfigSnapshotSchema = Type.Object(
	{
		// 構成を収集したsession。RunとConfigSnapshotはこのagent/session_idで結ぶ。
		agent: Agent,
		session_id: Token(),
		components: Type.Array(Component, { minItems: 1 }),
	},
	{ $id: schemaId("config-snapshot"), ...closed },
);
export type ConfigSnapshot = Static<typeof ConfigSnapshotSchema>;
