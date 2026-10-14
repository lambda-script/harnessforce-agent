# The claude-hud statusLine

Retrieved: 2026-10-10

This records the shape of the statusLine that claude-hud (a Claude Code plugin) writes to the user's user settings. It is one of the original statusLines that `harnessforce usage-limits statusline` wraps. On 2026-10-10 it was checked against the user settings on the user's device and the plugin source.

## Observed shape (2026-10-10, Claude Code 2.1.296, claude-hud 0.8.0)

The `statusLine` in the user's user settings (`~/.claude/settings.json`) has only these three items.

| Item | Value |
| --- | --- |
| `type` | `command` |
| `command` | A shell string. With `bash -c '...'`, it sets the terminal width in the environment variable `COLUMNS`, looks for the newest version directory under `plugins/cache/*/claude-hud/*/` in `$CLAUDE_CONFIG_DIR` or `$HOME/.claude`, and runs `dist/index.js` with `exec` using the absolute path of the Node.js executable |
| `refreshInterval` | `5` |

- `command` is a single string with nested shell quoting.
- `command` contains the absolute path of the Node.js executable. This differs from device to device, and it is saved as it is in `original`.

## What the claude-hud source says (in the plugin cache, 0.8.0)

- It reads `five_hour.used_percentage`, `five_hour.resets_at`, `seven_day.used_percentage`, `seven_day.resets_at`, and `model_scoped` (an array) from `rate_limits` in the JSON on stdin (`src/stdin.ts`, `src/types.ts`).
- The README says that the statusLine runs only after responses and similar events, so to keep a time-dependent display updating, add `refreshInterval` (seconds, minimum 1) to `statusLine`.
- `commands/setup.md` in the README says that Claude Code starts the statusLine command with bash.

Sources: the user settings on the user's device (observed 2026-10-10), and `src/stdin.ts`, `src/types.ts`, `README.md`, and `commands/setup.md` in the claude-hud 0.8.0 plugin cache.

## Not confirmed

- The shape of `statusLine` for other statusLine plugins or scripts.
- The shape of the `command` that claude-hud writes on Windows.
