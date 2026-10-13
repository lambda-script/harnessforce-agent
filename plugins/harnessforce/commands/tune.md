---
description: Analyze your past sessions and show the analysis results, the before and after of the previous suggestion, and suggested improvements for human interventions, repeatable loops, MCP servers, and usage. Does not modify files
argument-hint: "[--all] [--no-send]"
disable-model-invocation: true
---

# Analyze past sessions and suggest improvements

Go through the steps below in order. This run does not modify the user's files, settings, repository, or managed settings. The only things written are what `harnessforce tune` and `harnessforce tune record` write to `~/.harnessforce/tune/`.

## 1. Say that content goes to the model provider

Before running anything, show the following text as it is.

> To make suggestions, the agent reads part of the session records on this device in this run. What it reads goes to the provider of the model you normally use with this agent, through the same path as a normal session. It does not go to Harnessforce. Harnessforce receives only the analysis result values counted by the public rules.

## 2. Analyze

Run the following. It starts `harnessforce tune --json` and shows the analysis results and, for each target, the result of checking the conditions for making a suggestion. It includes sending and resending unsent results, so set the Bash timeout to 10 minutes.

```sh
node "${CLAUDE_PLUGIN_ROOT}/skills/propose-improvements/scripts/summarize.mjs" $ARGUMENTS
```

- The lines on stderr are the messages of `harnessforce tune`. Show all of them as they are, without omitting or rephrasing them.
- Show the analysis results on stdout (human interventions, repeatable loops, MCP servers, usage) as they are. Do not rephrase "not measured" as 0. Usage values stay on this device and are not sent to Harnessforce.
- If there is a "Before and after the previous suggestion" section, show it as it is before the new suggestions, and do not omit "Before/after difference (does not show causation)" or "The starting point is the time the application was detected". Do not rephrase "No comparison data" as a difference of 0.
- If the exit code is anything other than 0 or 3, finish without making suggestions. The same applies when the message says `harnessforce` was not found.
- If there is a "Not enough data, so no suggestions are made" line, show that line and finish without making suggestions.

## 3. Make suggestions

Show all the "Targets for suggestions" lines. Show the "Not enough data" and "not measured, so no suggestion is made" lines as they are, including what is still needed, and make no suggestion for those targets.

For the targets marked "a suggestion can be made", make suggestions by following the `propose-improvements` skill of this plugin, record them with `harnessforce tune record`, and then show them. Do not show a suggestion whose recording did not end with exit code 0.

## 4. Explain how to apply

Finally, tell the user that applying the suggestions is up to the user. They apply them by editing by hand, running `git apply`, or telling the agent in their own session to apply them. This command does not apply them. A suggestion that was applied is detected in the next run of `/harnessforce:tune`, and only counts are sent to Harnessforce.
