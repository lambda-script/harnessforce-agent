#!/usr/bin/env bash
# A repository whose export command has the --quiet flag that the prompt asks to rename.
set -euo pipefail
export GIT_AUTHOR_NAME=eval GIT_AUTHOR_EMAIL=eval@example.com GIT_COMMITTER_NAME=eval GIT_COMMITTER_EMAIL=eval@example.com
git init -q -b main
mkdir -p src
cat > src/export.ts <<'TS'
export function parseExportFlags(argv: string[]) {
	return { quiet: argv.includes("--quiet") };
}
TS
git add src/export.ts
git commit -q -m "feat: add the export command"
