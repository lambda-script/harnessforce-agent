---
description: Harnessforce setup. Walks through checking Node.js, choosing whether to send session content, installing the CLI, running harnessforce init, importing past sessions, showing the remaining workspace steps, and confirming the first event after the restart
---

# Harnessforce setup

Go through the steps below in order, interacting with the user. Run this setup when the user types `/harnessforce:setup`, or when the user asks to install, connect or set up Harnessforce. Do not run it when the user has not asked for it. Running it again is safe: every step converges to the same state.

## How setup ends

Setup ends only at one of the endings below, and the last line of the ending is the text shown here, as it is. Do not tell the user that setup has ended at any other point, and do not use words that say setup is finished ("complete", "done" and so on) except in the second ending of part 2.

- Node.js is missing or below 18 (step 1): the text in step 1.
- Stopped part way: "Harnessforce setup stopped at step {n} ({name}). Fix the cause shown above, then run `/harnessforce:setup` again. Steps already done are safe to repeat." Replace `{n}` and `{name}` with the number and the heading of the step that failed.
- End of part 1 (step 8): "Harnessforce setup, part 1 of 2, is done. Restart Claude Code, then run `/harnessforce:setup` again in the new session. Part 2 checks that the first event arrived."
- End of part 2 (step 9): "Harnessforce setup is complete."

When a command fails, show its output to the user. Whether setup then stops or goes on is written in each step. Errors that other plugins' hooks show do not affect setup: do not stop because of them and do not mention them.

## 1. Check Node.js

First run `node --version`. If the command is not found, or the version is below 18, do not move on to installing the CLI. Show the following text as it is and stop.

> Harnessforce hooks require Node.js 18 or later. Install Node.js, restart Claude Code, then run `/harnessforce:setup` again.

## 2. Check whether this run is after the restart

If `harnessforce --version` succeeds and the environment variable `HARNESSFORCE_WORKSPACE_ID` of this session is not empty, this is a session restarted after `harnessforce init`. Skip steps 3 to 8 and go to step 9.

## 3. Install the CLI

If `harnessforce --version` succeeds, do not install anything. Otherwise run the following, then confirm the install with `harnessforce --version`.

```sh
npm install -g @harnessforce/cli
```

If the install fails, show its output and stop at this step. When npm cannot write to its global install location (`EACCES`), also show the following before the last line.

> npm cannot write to its global install location. Use a Node.js installed with a version manager such as nvm, or change npm's prefix to your own directory, then try again.

## 4. Choose whether to send content

Before `harnessforce init`, present the option to send the content of the user's sessions, with "send" selected by default. The login is not done yet at this point, so neither the Workspace to connect nor what it stores is known. Do not change what you show depending on the Workspace; `harnessforce init` decides each category from the Workspace it connects, and writes `0` for a category the Workspace does not store.

Present the option together with the following.

- If selected, the prompts the user types, model responses, and tool input and output (including Bash commands and file paths) are delivered to this Workspace for the categories the Workspace stores. Secret patterns, email addresses, and phone numbers are replaced with `[REDACTED:kind]` before storing, and the content is deleted after the content retention period (30 days by default, at most 30 days). Secrets and personal information that do not match a pattern are not masked, and not everything can be detected. Who can read the stored content follows the Workspace setting (everyone in the Workspace by default); `harnessforce init` shows the setting of the Workspace it connects. The user can delete their own content from the account settings, and the sender, owners and admins can delete a session's content at any time.
- Content is stored only when both this setting on the device and the Workspace's storing of that category are in place. If the Workspace stops storing a category, later content is discarded on receipt.
- If selected, run `harnessforce init --send-content`; if not, run `harnessforce init` (step 5). Write this setting to the `env` of the Claude Code user settings, and do not write it to the `env` of the project (`.claude/settings.json`) or local (`.claude/settings.local.json`) files, because the content variables are ignored in the `env` of those two files. A restart is needed after `harnessforce init` for the setting to take effect.
- To stop afterwards, run `harnessforce init` again without `--send-content`. It rewrites the content variables to `0`.

Use the following option text as it is.

> Send the content of your sessions (on by default). The prompts you type, model responses and tool input and output (including Bash commands and file paths) are delivered to this workspace and stored for the categories the workspace stores. Values that match known patterns for secrets and personal information are replaced with `[REDACTED:kind]`, but not everything can be detected. Content is deleted after the content retention period (30 days by default, at most 30 days). Who can read it follows the workspace setting (everyone in the workspace by default); `harnessforce init` shows the setting of the workspace you connect. You can delete your own content from your account settings, and the sender, owners and admins can delete a session's content at any time.

## 5. Connect to Harnessforce

Follow the choice in step 4: run `harnessforce init --send-content` if selected, or `harnessforce init` if not. Tell the user to log in to Harnessforce in the browser, or sign up, and choose one Workspace to connect. A user without a Workspace can create one on the same page and continue. If the browser does not open, show the user the URL that `harnessforce init` prints. The command waits up to 5 minutes for the login to complete, so run it with a Bash timeout of 10 minutes.

For a Workspace that stores no content, `harnessforce init --send-content` writes the content variables as `0`. It prints a message about that and about Collection & retention in the Workspace settings, and exits with code 0. Do not treat this as a failure; show the printed text to the user as it is.

If `harnessforce init` ends with the line saying the CLI version is unsupported and exit code 1, run `npm install -g @harnessforce/cli@latest`, then run this step again. If `harnessforce init` fails for any other reason, show what it printed and stop at this step; a failed `harnessforce init` changes neither the keychain nor the settings files.

## 6. Import past sessions

Run `harnessforce import` and tell the user, as it is, the imported count it prints, along with the breakdown of sessions that were not imported and the guidance. Do not omit the printed reason and the next action even when the count is 0.

Then run `harnessforce status --json`. If `repository.connected` is `false` (the repository of the working directory is not connected), tell the user the following.

> This repository is not connected to the GitHub App, so its sessions were not imported. After connecting it, restart Claude Code and run `/harnessforce:setup` to import them.

If `harnessforce import` fails, show its output and go on; importing is not needed for telemetry and can be run later. Before the last line of the ending, show "Importing past sessions failed. Run `harnessforce import` later." If `harnessforce status --json` fails, show its output and go on.

## 7. Show the remaining steps

From the result of `harnessforce status --json` in step 6, show the steps that are not done (`status` other than `done` in `steps`, and every step in `admin_steps`) in the order of their numbers, each with its title, who does it, and the URL of its page. Use these titles: step 2 "Connect the GitHub App", step 3 "Assign repositories to a project", step 4 "Set up telemetry", step 5 "Wait for your first run". Steps 2 and 3 are done by an owner or admin, and steps 4 and 5 by the user. For a step the user is not responsible for (steps 2 and 3 when the user's `role` is `member`), add "Send this URL to the person responsible."

If `has_seat` is `false`, first show "You don't have a developer seat, so the telemetry you send is not stored." If no step remains, show only "Your workspace is ready." If `harnessforce status --json` failed in step 6, show the URL of the Harnessforce Home (the environment variable `HARNESSFORCE_URL`) instead of the steps.

## 8. Ask for a restart

If the user also uses Codex, tell them first: restart Codex, then run `/hooks` in Codex and trust the harnessforce `SessionStart`, `PostToolUse`, and `Stop` hooks. Codex runs a hook only after the user trusts it, and `harnessforce init` cannot do this for them.

Then end with the following.

> Harnessforce setup, part 1 of 2, is done. Restart Claude Code, then run `/harnessforce:setup` again in the new session. Part 2 checks that the first event arrived.

## 9. Confirm the first event

At the start of this session, the plugin hook sent the session to Harnessforce. Run `harnessforce import` again to import the sessions of repositories connected to the GitHub App after step 6; sessions already imported are not sent twice. Tell the user the result as in step 6.

Then run `harnessforce status --json`. If step 5 is `done`, show "Your first run arrived." with the URL of the Harnessforce Home (the environment variable `HARNESSFORCE_URL`). If not, show the Home URL and tell the user to check on the waiting screen for the first run that it was received; if nothing arrives after 15 minutes, follow the checks for each cause shown on the waiting screen. Show the steps that are not done in the same way as step 7.

If `harnessforce import` fails, show its output, go on, and show "Importing past sessions failed. Run `harnessforce import` later." before the last line. If `harnessforce status --json` fails, show its output and the Home URL, and still end with the line below: the settings were made in step 5, so not being able to read the status is not a failure of setup.

> Harnessforce setup is complete.
