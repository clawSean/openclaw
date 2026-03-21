---
summary: "CLI reference for `openclaw report` (bug reports, feature requests, and private security packets)"
read_when:
  - You want to prepare a sanitized GitHub issue draft from local OpenClaw state
  - You want to submit a public bug or feature issue with `gh`
  - You need a private security report packet instead of a public issue
title: "report"
---

# `openclaw report`

Prepare sanitized reports for `openclaw/openclaw`.

`openclaw report` turns a small amount of user input plus local runtime/config context into:

- public bug report drafts
- public feature request drafts
- private security report packets

Public bug and feature reports can optionally be submitted with `gh`. Security reports never create a public GitHub issue.

## Subcommands

- `openclaw report bug`
- `openclaw report feature`
- `openclaw report security`

## Shared flags

- `--title <text>`: explicit report title
- `--summary <text>`: short summary (used in public reports and as a fallback title)
- `--json`: emit the structured sanitized payload
- `--markdown`: emit only the rendered report body
- `--output <file>`: write the sanitized body to a file
- `--submit`: submit a public bug/feature issue when the report is ready
- `--yes`: skip interactive confirmation for submission
- `--non-interactive`: disable prompts; public submission requires `--yes`

If neither `--json` nor `--markdown` is passed, the default output is a human-readable sanitized preview.

`--yes` only skips the final interactive confirmation. It does not skip draft generation, diagnostics, or probe execution.

## Bug reports

Use `openclaw report bug` for broken behavior, regressions, or operational failures.

Examples:

```bash
openclaw report bug \
  --summary "Gateway times out behind mitmproxy" \
  --repro "1. Start gateway behind proxy\n2. Send any LLM request" \
  --expected "Model responds successfully" \
  --actual "Requests fail with timeout" \
  --impact "Blocks all LLM traffic"
```

```bash
openclaw report bug \
  --summary "Gateway times out behind mitmproxy" \
  --repro "1. Start gateway behind proxy\n2. Send any LLM request" \
  --expected "Model responds successfully" \
  --actual "Requests fail with timeout" \
  --impact "Blocks all LLM traffic" \
  --probe gateway \
  --submit
```

Bug-specific flags:

- `--repro <text>`: steps to reproduce
- `--expected <text>`: expected behavior
- `--actual <text>`: observed behavior
- `--impact <text>`: severity or workflow impact
- `--previous-version <text>`: optional regression context
- `--evidence <text>`: extra evidence to append
- `--additional-information <text>`: broad extra details, clues, timelines, or hypotheses
- `--context <text>`: compatibility alias for `--additional-information`
- `--probe <general|model|channel|gateway|none>`: bounded evidence collection mode

Required fields for a submission-eligible bug report:

- summary
- repro
- expected
- actual
- impact

Auto-collected where available:

- OpenClaw version
- OS/runtime summary
- configured model/provider hints
- a short bounded probe summary when `--probe` is enabled

Probe guidance:

- `general`: runtime summary, proxy env context, gateway/model/channel signals, and one recent sanitized runtime error when available
- `gateway`: gateway reachability, health, and proxy context
- `model`: provider auth overview plus a bounded live model-path check with combined proxy-status output
- `channel`: configured-channel summary plus recent channel/runtime issue hints

## Feature requests

Use `openclaw report feature` for improvements or new capabilities.

Examples:

```bash
openclaw report feature \
  --summary "Add a report dry-run flag" \
  --problem "Operators want draft output without touching GitHub" \
  --solution "Support report --submit only when explicitly requested" \
  --impact "Safer issue authoring from scripts"
```

Feature-specific flags:

- `--problem <text>`: problem to solve
- `--solution <text>`: proposed solution
- `--impact <text>`: expected impact
- `--alternatives <text>`: alternatives considered
- `--evidence <text>`: examples or supporting evidence
- `--additional-information <text>`: broad extra details, clues, timelines, or hypotheses
- `--context <text>`: compatibility alias for `--additional-information`
- `--probe <general|model|channel|gateway|none>`: optional bounded evidence collection

Required fields for a submission-eligible feature request:

- summary
- problem
- solution
- impact

## Security reports

Use `openclaw report security` for private vulnerability reports or sensitive disclosures.

Example:

```bash
openclaw report security \
  --title "Gateway token exposed in logs" \
  --severity high \
  --impact "Operator credential disclosure" \
  --component "gateway auth logging" \
  --reproduction "Run startup flow with verbose logging enabled" \
  --demonstrated-impact "Token appears in terminal output" \
  --environment "macOS 15.4, OpenClaw 2026.3.x" \
  --remediation "Mask auth values before logging"
```

Security-specific flags:

- `--severity <text>`
- `--impact <text>`
- `--component <text>`
- `--reproduction <text>`
- `--demonstrated-impact <text>`
- `--environment <text>`
- `--remediation <text>`

Rules:

- `report security` never calls `gh issue create`
- `--submit` is ignored as a public-issue path and returns a blocked submission status
- terminal output stays private-report-oriented
- use `--output` or `--markdown` to save a private report packet for manual sending

Private route: send completed security reports to `security@openclaw.ai`.

## Redaction and submission behavior

The command sanitizes common sensitive values before rendering output or submitting:

- tokens / bearer values / API keys
- email addresses
- phone numbers
- private user handles
- local user path prefixes such as `/Users/<name>` or `/home/<name>`

For public bug and feature reports:

- `--submit` is required before any GitHub issue is created
- interactive runs ask for confirmation before `gh issue create`
- non-interactive submission requires both `--submit` and `--yes`
- if required fields are missing, the command returns a structured blocked state instead of guessing
- generated report bodies include a short provenance footer noting they were generated via `openclaw report`

## JSON output

`--json` emits a stable sanitized payload with fields such as:

- `kind`
- `title`
- `body`
- `labels`
- `evidence`
- `redactionsApplied`
- `missingFields`
- `submissionEligible`
- `submission`

This is intended for scripting and higher-level automation.
