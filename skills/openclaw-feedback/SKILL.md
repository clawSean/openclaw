---
name: openclaw-feedback
description: Turn bug reports, feature requests, and security disclosures into the right `openclaw report` flow for `openclaw/openclaw`.
user-invocable: true
metadata:
  {
    "openclaw":
      {
        "emoji": "🐙",
        "requires": { "bins": ["gh"] },
        "install":
          [
            {
              "id": "brew",
              "kind": "brew",
              "formula": "gh",
              "bins": ["gh"],
              "label": "Install GitHub CLI (brew)",
            },
          ],
      },
  }
---

# OpenClaw Feedback

Use this skill only for `openclaw/openclaw`.

## Goal

- Route the user into the correct `openclaw report` flow with minimal extra questions.
- Treat `openclaw report` as the only authoritative path for drafting, previewing, diagnostics, redaction, and submission results.

## Do

- Tell the user you are using the `openclaw-feedback` skill.
- In that opening, explain that getting enough context matters because stronger context produces a more accurate, actionable GitHub issue and avoids weak or misleading filings.
- Decide `bug`, `feature`, or `private security report`.
- Ask only for missing required fields, with at most 1-3 short questions.
- Treat `openclaw report bug|feature|security` as the source of truth for drafting, redaction, diagnostics, previewing, and submission behavior.
- If you are unsure about flags or subcommand shape, run `openclaw report --help` before invoking the report flow.
- Tell the user report generation can take a moment when diagnostics or probes are included.
- Relay the generated draft or blocked result from `openclaw report` directly.
- Ask permission before adding `--submit`.
- Only after approval, use `--submit` for public bug or feature issues.

## Do Not

- Never create the issue before user approval.
- Never file against any repo other than `openclaw/openclaw`.
- Never maintain a separate manual issue-writing path when `openclaw report` is available.
- Never publish a security report as a public issue.
- Never fall back to manual filing if `openclaw report` or `gh` is unavailable.

## If X Then Y

- If the request is a vulnerability, leaked credential, or private security report: use `openclaw report security`; do not create a public issue.
- If the request is clearly a broken behavior or regression: use `openclaw report bug`.
- If the request is clearly asking for a new capability or improvement: use `openclaw report feature`.
- If the type is unclear: ask one short question to decide bug vs feature.
- If the user already gave enough detail: skip extra questions.
- If diagnostics would materially improve the report: use `--probe general|gateway|model|channel` on the `openclaw report` command instead of assembling standalone diagnostics yourself.
- If the issue is still too weak after a short recovery attempt: return `NOT_ENOUGH_INFO`.
- If unsafe content cannot be safely redacted without losing the technical meaning: return `BLOCKED_UNSAFE_CONTENT`.
- If `openclaw report` or `gh` is unavailable: return `BLOCKED_MISSING_TOOL`.

## Workflow

1. Say: `I’m using the openclaw-feedback skill to prepare an OpenClaw GitHub issue. I want to gather enough context to make the issue accurate and useful for maintainers without over-questioning you. Report generation can take a moment if I include diagnostics or probes.`
2. Decide `bug`, `feature`, or `private security report`.
3. Ask only for missing required fields:
   - bug: summary, steps to reproduce, expected behavior, actual behavior, impact
     optional regression context: previous version -> `--previous-version`
   - feature: summary, problem to solve, proposed solution, impact
   - security: title, severity, impact, affected component, technical reproduction, demonstrated impact, environment, remediation advice
4. Choose the matching command:
   - `openclaw report bug`
   - `openclaw report feature`
   - `openclaw report security`
5. If targeted diagnostics are useful, add one probe mode:
   - `--probe general`
   - `--probe gateway`
   - `--probe model`
   - `--probe channel`
     Choose `--probe gateway` for proxy, gateway, or timeout/network failures.
     Choose `--probe model` for provider auth, model-call, or dispatcher/proxy-path issues.
     Choose `--probe channel` for channel integrations or account-specific failures.
6. Run `openclaw report <kind> ...` and trust its output as authoritative.
7. Show the generated draft or blocked result without reformatting it into a separate skill-owned state machine.
8. If the user wants to inspect more detail, show the full sanitized draft from the CLI output.
9. Only if the user clearly approves, rerun or continue with `--submit` for public bug or feature issues.
10. For security, keep the report private and route the user to `security@openclaw.ai`.

## Common Commands

- Help: `openclaw report --help`
- Bug draft: `openclaw report bug`
- Feature draft: `openclaw report feature`
- Security private report draft: `openclaw report security`
- Public issue submission after approval: add `--submit`

## Flag Mapping

- summary -> `--summary`
- repro -> `--repro`
- expected -> `--expected`
- actual -> `--actual`
- impact -> `--impact`
- previous version -> `--previous-version`
- additional information -> `--additional-information`
- feature problem -> `--problem`
- feature solution -> `--solution`

Use `--additional-information` for details that do not fit neatly into `--repro`, `--expected`, `--actual`, or `--evidence`, including:

- useful loose context
- regression clues
- timelines
- unusual observations
- operator hypotheses worth preserving

## Private Security Reports

If the request is a security issue:

- use `openclaw report security` as the source of truth for the private report draft
- do not create a public GitHub issue
- do not include exploit details in chat unless needed to route the report
- ask only for missing required private-report fields
- briefly summarize the category, affected area, and impact in private-report-safe terms only
- tell the user to report it privately to `security@openclaw.ai`

## PII And Secret Redaction

- Let `openclaw report` handle redaction by default.
- If you must quote or summarize content before invoking it, redact tokens, passwords, emails, phone numbers, private-person handles, home-directory names, and unnecessary local file paths.

## Permission Preview

Let `openclaw report` define the preview, readiness, blocked-submission, and created-output wording.

Do not restate or simulate `READY_TO_CREATE`, `SUBMISSION_BLOCKED`, or other CLI output formats inside this skill.

If the user has not clearly approved filing, stop before adding `--submit`.

## Notes

- `openclaw report` is the authoritative path for title/body formatting, bounded diagnostics, redaction, degraded diagnostics handling, submission gating, and `gh` failure behavior.
- Keep this skill focused on orchestration, not manual issue authoring.
- Do not invent extra workflow, output schema, or issue-body rules beyond what `openclaw report` already implements.

## Examples

### Example: bug with gateway diagnostics

User says: `OpenClaw times out behind mitmproxy.`

Assistant says:

```text
I’m using the openclaw-feedback skill to prepare an OpenClaw GitHub issue. I want to gather enough context to make the issue accurate and useful for maintainers without over-questioning you. Report generation can take a moment if I include diagnostics or probes.

I need a few bug-report details: what steps reproduce it, what you expected, what actually happened, and the impact.
```

If the user provides those fields, run:

```bash
openclaw report bug --summary "Gateway times out behind mitmproxy" --repro "..." --expected "..." --actual "..." --impact "..." --probe gateway
```

Then relay the generated draft or blocked result directly. Only add `--submit` after explicit approval.

### Example: regression bug with loose extra context

User says: `This worked last week, but after updating it started timing out.`

Assistant says:

```text
I’m using the openclaw-feedback skill to prepare an OpenClaw GitHub issue. I want to gather enough context to make the issue accurate and useful for maintainers without over-questioning you. Report generation can take a moment if I include diagnostics or probes.

I need the repro steps, expected behavior, actual behavior, and impact. I can also include the previous version and any extra observations that do not fit neatly into the main bug fields.
```

If the user provides those fields, run:

```bash
openclaw report bug --summary "Regression after update" --repro "..." --expected "..." --actual "..." --impact "..." --previous-version "2026.3.14" --additional-information "Worked last week; now every call times out behind the same proxy setup." --probe model
```

### Example: feature request

User says: `Please add a way to export a report draft without submitting it.`

If the user already gave enough detail, run:

```bash
openclaw report feature --summary "Export report drafts without submission" --problem "Operators want a clean draft artifact without creating a GitHub issue" --solution "Allow report generation and file output without submit" --impact "Safer scripted issue authoring"
```

### Example: private security report

User says: `I found a token leak in logs.`

Assistant says:

```text
I’m using the openclaw-feedback skill to route this into the private OpenClaw security-report flow. I want to gather enough context to make the report accurate and actionable while keeping it private.
```

Then gather only missing private-report fields and run:

```bash
openclaw report security --title "Token leak in logs" --severity high --impact "..." --component "..." --reproduction "..." --demonstrated-impact "..." --environment "..." --remediation "..."
```

Do not create a public issue.
