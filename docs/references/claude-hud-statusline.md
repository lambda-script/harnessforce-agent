# claude-hudのstatusLine

取得日: 2026-10-10

`harnessforce usage-limits statusline`が元のstatusLineとして包む対象のうち、claude-hud（Claude Codeのplugin）が利用者のuser settingsへ書くstatusLineの形を記す。[AI agentの利用枠](https://github.com/lambda-script/harnessforce/blob/main/docs/references/agent-usage-limits.md)が同じ形を2026-10-09に記録している。ここでは2026-10-10に、利用者の端末のuser settingsとpluginのsourceで確かめ直した。

## 観測した形（2026-10-10、Claude Code 2.1.296、claude-hud 0.8.0）

利用者のuser settings（`~/.claude/settings.json`）の`statusLine`は、次の3つの項目だけを持つ。

| 項目 | 値 |
| --- | --- |
| `type` | `command` |
| `command` | shellの文字列。`bash -c '...'`で、terminalの幅を環境変数`COLUMNS`に設定し、`$CLAUDE_CONFIG_DIR`または`$HOME/.claude`の`plugins/cache/*/claude-hud/*/`から最も新しいversionのdirectoryを探し、Node.jsの実行fileの絶対pathで`dist/index.js`を`exec`する |
| `refreshInterval` | `5` |

- `command`はshellの引用符を入れ子にした1本の文字列。
- `command`はNode.jsの実行fileの絶対pathを含む。端末ごとに異なる値であり、`original`へ元のまま保存する。

## claude-hudのsourceの記述（plugin cache内、0.8.0）

- stdinのJSONの`rate_limits`から`five_hour.used_percentage`、`five_hour.resets_at`、`seven_day.used_percentage`、`seven_day.resets_at`と、`model_scoped`（配列）を読む（`src/stdin.ts`、`src/types.ts`）。
- READMEは、statusLineが応答の後などにだけ走るため、時刻に依存する表示を更新し続けるには`statusLine`に`refreshInterval`（秒、最小1）を足すよう案内する。
- READMEの`commands/setup.md`は、Claude CodeがstatusLineのcommandをbashで起動すると記す。

出典: 利用者の端末のuser settings（観測日 2026-10-10）、claude-hud 0.8.0のplugin cache内の`src/stdin.ts`、`src/types.ts`、`README.md`、`commands/setup.md`。

## 確認できていないこと

- 他のstatusLine用のpluginやscriptの`statusLine`の形。
- Windowsでclaude-hudが書く`command`の形。
