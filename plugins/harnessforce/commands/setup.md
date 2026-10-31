---
description: Harnessforce setup. Walks through checking Node.js, choosing whether to send session content, installing the CLI, running harnessforce init, importing past sessions, and confirming the first event after the restart
disable-model-invocation: true
---

# Harnessforce setup

Go through the steps below in order, interacting with the user. If a command fails, show its output to the user and stop without moving on to the later steps.

## 1. Check Node.js

First run `node --version`. If the command is not found, or the version is below 18, do not move on to installing the CLI. Show the following text as it is and stop.

> Harnessforce hooks require Node.js 18 or later. Install Node.js, restart Claude Code, then run `/harnessforce:setup` again.

## 2. Check whether this run is after the restart

If `harnessforce --version` succeeds and the environment variable `HARNESSFORCE_WORKSPACE_ID` of this session is not empty, this is a session restarted after `harnessforce init`. Skip steps 3 to 7 and go to step 8.

## 3. Install the CLI

Run the following, then confirm the install with `harnessforce --version`.

```sh
npm install -g @harnessforce/cli
```

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

Follow the choice in step 4: run `harnessforce init --send-content` if selected, or `harnessforce init` if not. Tell the user to log in to Harnessforce in the browser and choose one Workspace to connect. If the browser does not open, show the user the URL that `harnessforce init` prints. The command waits up to 5 minutes for the login to complete, so run it with a Bash timeout of 10 minutes.

For a Workspace that stores no content, `harnessforce init --send-content` writes the content variables as `0`. It prints a message about that and about Collection & retention in the Workspace settings, and exits with code 0. Do not treat this as a failure; show the printed text to the user as it is.

## 6. Import past sessions

Run `harnessforce import` and tell the user, as it is, the imported count it prints, along with the breakdown of sessions that were not imported and the guidance. Do not omit the printed reason and the next action even when the count is 0.

## 7. Ask for a restart

Tell the user the following and stop.

> Harnessforce setup, part 1 of 2, is done. Restart Claude Code, then run `/harnessforce:setup` again in the new session. Part 2 checks that the first event arrived.

## 8. Confirm the first event

At the start of this session, the plugin hook sent the session to Harnessforce. Tell the user to open the Harnessforce Home in the browser (the URL in the environment variable `HARNESSFORCE_URL`) and confirm on the waiting screen for the first Run that it was received. If nothing arrives after 15 minutes, tell the user to follow the checks for each cause shown on the waiting screen. Finish with the following line.

> Harnessforce setup is complete.
