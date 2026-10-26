---
description: Harnessforce setup. Walks through checking Node.js, choosing whether to send prompt content, installing the CLI, running harnessforce init, importing past sessions, and confirming the first event after the restart
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

## 4. Choose whether to send prompt content

Before `harnessforce init`, present the option to send prompt content to the user, not selected by default. The login is not done yet at this point, so neither the Workspace to connect nor its opt-in state is known. Do not change what you show depending on the opt-in.

Present the option together with the following.

- If selected, the body of the prompts the user types to the agent is delivered to this Workspace. Secret patterns, email addresses, and phone numbers are replaced with `[REDACTED:kind]` before storing, and the content is deleted after the content retention period (at most 30 days). Secrets and personal information that do not match a pattern are not masked, and not everything can be detected. Within the Workspace, only the person who sent the stored content can read it; Owners and Admins cannot read it either. That person can delete their own content at any time from My practices.
- Content is stored only when both this setting on the device and the Workspace opt-in are in place. If the Workspace opt-in is withdrawn, later content is discarded on receipt and existing content data can no longer be read. This setting does not enable sending model responses or tool input and output.
- If selected, run `harnessforce init --send-content`; if not, run `harnessforce init` (step 5). Write this setting to the `env` of the Claude Code user settings, and do not write it to the `env` of the project (`.claude/settings.json`) or local (`.claude/settings.local.json`) files, because the content variable is ignored in the `env` of those two files.
- To stop after selecting it, set `OTEL_LOG_USER_PROMPTS` in the `env` of the user settings to `0`. The value that stops it also takes effect in the project and local `env`.

Use the following option text as it is.

> You can send the prompts you type for analysis (off by default; it takes effect only if the workspace has opted in to prompts you typed). If enabled, the prompts you type to the agent are delivered to this workspace and stored. Values that match known patterns for secrets and personal information are replaced with `[REDACTED:kind]`, but not everything can be detected. Content is deleted after the content retention period (at most 30 days), and within the workspace only you can read it. You can delete it at any time from My practices. Enable this?
>
> Content is not sent (by default). You can enable it later.

## 5. Connect to Harnessforce

Follow the choice in step 4: run `harnessforce init --send-content` if selected, or `harnessforce init` if not. Tell the user to log in to Harnessforce in the browser and choose one Workspace to connect. If the browser does not open, show the user the URL that `harnessforce init` prints. The command waits up to 5 minutes for the login to complete, so run it with a Bash timeout of 10 minutes.

For a Workspace that has not opted in, `harnessforce init --send-content` does not write the content setting. It prints a message about that and about the Data retention page of the Workspace settings, and exits with code 0. Do not treat this as a failure; show the printed text to the user as it is.

## 6. Import past sessions

Run `harnessforce import` and tell the user, as it is, the imported count it prints, along with the breakdown of sessions that were not imported and the guidance. Do not omit the printed reason and the next action even when the count is 0.

## 7. Ask for a restart

Tell the user the following and stop.

> Harnessforce setup, part 1 of 2, is done. Restart Claude Code, then run `/harnessforce:setup` again in the new session. Part 2 checks that the first event arrived.

## 8. Confirm the first event

At the start of this session, the plugin hook sent the session to Harnessforce. Tell the user to open the Harnessforce Home in the browser (the URL in the environment variable `HARNESSFORCE_URL`) and confirm on the waiting screen for the first Run that it was received. If nothing arrives after 15 minutes, tell the user to follow the checks for each cause shown on the waiting screen. Finish with the following line.

> Harnessforce setup is complete.
