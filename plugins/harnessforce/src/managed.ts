// fileで配るmanaged settingsのdirectory（correlation.md「構成の収集」、claude-code.md「設定」）。
const MANAGED_DIRS: Partial<Record<NodeJS.Platform, string>> = {
	darwin: "/Library/Application Support/ClaudeCode",
	win32: "C:\\Program Files\\ClaudeCode",
};

// LinuxとWSL（Linuxとして動く）は/etc/claude-codeを使う。
export const managedDirFor = (platform: NodeJS.Platform) =>
	MANAGED_DIRS[platform] ?? "/etc/claude-code";
