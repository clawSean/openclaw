import type { Command } from "commander";
import {
  reportCommand,
  type BugProbeMode,
  type BugReportOptions,
  type FeatureReportOptions,
  type SecurityReportOptions,
} from "../../commands/report.js";
import { defaultRuntime } from "../../runtime.js";
import { formatDocsLink } from "../../terminal/links.js";
import { theme } from "../../terminal/theme.js";
import { runCommandWithRuntime } from "../cli-utils.js";
import { formatHelpExamples } from "../help-format.js";

function addSharedOptions(command: Command) {
  return command
    .option("--title <text>", "Report title")
    .option("--summary <text>", "Short report summary")
    .option("--json", "Output JSON instead of text", false)
    .option("--markdown", "Output rendered Markdown body", false)
    .option("--output <file>", "Write the sanitized body to a file")
    .option("--submit", "Create the GitHub issue when the report is ready", false)
    .option("--yes", "Skip interactive confirmation for submission", false)
    .option("--non-interactive", "Disable prompts; requires --yes for submission", false);
}

function resolveProbe(value: unknown): BugProbeMode | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim().toLowerCase();
  if (
    trimmed === "general" ||
    trimmed === "model" ||
    trimmed === "channel" ||
    trimmed === "gateway" ||
    trimmed === "none"
  ) {
    return trimmed;
  }
  throw new Error("--probe must be one of: general, model, channel, gateway, none");
}

export function registerReportCommand(program: Command) {
  const report = program
    .command("report")
    .description("Prepare sanitized bug, feature, and security reports for openclaw/openclaw")
    .addHelpText(
      "after",
      () =>
        `\n${theme.heading("Behavior:")}\n- Running ${theme.command("openclaw report ...")} without ${theme.command("--submit")} generates a draft/preview.\n- Add ${theme.command("--submit")} to create the issue after approval.\n- Non-interactive submission requires ${theme.command("--submit --yes")}.\n\n${theme.heading("Examples:")}\n${formatHelpExamples(
          [
            [
              'openclaw report bug --summary "Gateway timeouts" --repro "..."',
              "Draft and preview a bug report.",
            ],
            [
              'openclaw report bug --summary "Gateway timeouts" --repro "..." --expected "..." --actual "..." --impact "..." --probe gateway',
              "Draft a bug report with gateway and proxy diagnostics.",
            ],
            [
              'openclaw report bug --summary "Regression after update" --repro "..." --expected "..." --actual "..." --impact "..." --previous-version "2026.3.14"',
              "Draft a regression report with previous-version context.",
            ],
            [
              'openclaw report bug --summary "Gateway timeouts" --repro "..." --expected "..." --actual "..." --impact "..." --additional-information "Worked last week behind mitmproxy; now every call times out."',
              "Draft a bug report with broad additional information.",
            ],
            [
              'openclaw report bug --summary "Gateway timeouts" --repro "..." --expected "..." --actual "..." --impact "..." --submit --yes',
              "Submit in non-interactive mode when all required fields are present.",
            ],
            [
              'openclaw report feature --summary "Add foo" --problem "..." --solution "..." --impact "..."',
              "Draft a feature request.",
            ],
            [
              'openclaw report security --title "Token leak" --severity high --impact "..."',
              "Prepare a private security report packet.",
            ],
          ],
        )}`,
    )
    .addHelpText(
      "after",
      () =>
        `\n${theme.muted("Docs:")} ${formatDocsLink("/cli/report", "docs.openclaw.ai/cli/report")}\n`,
    );

  addSharedOptions(
    report
      .command("bug")
      .description("Prepare a public bug report for openclaw/openclaw")
      .option("--repro <text>", "Steps to reproduce")
      .option("--expected <text>", "Expected behavior")
      .option("--actual <text>", "Actual behavior")
      .option("--impact <text>", "User or operator impact")
      .option("--previous-version <text>", "Optional previous version for regression context")
      .option("--evidence <text>", "Extra evidence to include")
      .option(
        "--additional-information <text>",
        "Broad extra details, clues, timelines, hypotheses, or other useful context",
      )
      .option("--context <text>", "Compatibility alias for additional information")
      .option(
        "--probe <mode>",
        "Targeted diagnostics: general=runtime+proxy, gateway=reachability, model=auth/live check, channel=channel status, none=skip",
      )
      .action(async (opts) => {
        const options: BugReportOptions = {
          ...opts,
          probe: resolveProbe(opts.probe),
        };
        await runCommandWithRuntime(defaultRuntime, async () => {
          await reportCommand({ kind: "bug", options, runtime: defaultRuntime });
        });
      }),
  );

  addSharedOptions(
    report
      .command("feature")
      .description("Prepare a public feature request for openclaw/openclaw")
      .option("--problem <text>", "Problem to solve")
      .option("--solution <text>", "Proposed solution")
      .option("--impact <text>", "Expected impact")
      .option("--alternatives <text>", "Alternatives considered")
      .option("--evidence <text>", "Supporting evidence or examples")
      .option(
        "--additional-information <text>",
        "Broad extra details, clues, timelines, hypotheses, or other useful context",
      )
      .option("--context <text>", "Compatibility alias for additional information")
      .option(
        "--probe <mode>",
        "Optional diagnostics context: general=runtime+proxy, gateway=reachability, model=auth/live check, channel=channel status, none=skip",
      )
      .action(async (opts) => {
        const options: FeatureReportOptions = {
          ...opts,
          probe: resolveProbe(opts.probe),
        };
        await runCommandWithRuntime(defaultRuntime, async () => {
          await reportCommand({ kind: "feature", options, runtime: defaultRuntime });
        });
      }),
  );

  addSharedOptions(
    report
      .command("security")
      .description("Prepare a private security report packet")
      .option("--severity <text>", "Severity assessment")
      .option("--impact <text>", "Demonstrated impact")
      .option("--component <text>", "Affected component")
      .option("--reproduction <text>", "Technical reproduction")
      .option("--demonstrated-impact <text>", "Observed exploit or impact")
      .option("--environment <text>", "Environment details")
      .option("--remediation <text>", "Suggested remediation advice")
      .action(async (opts) => {
        const options: SecurityReportOptions = { ...opts };
        await runCommandWithRuntime(defaultRuntime, async () => {
          await reportCommand({ kind: "security", options, runtime: defaultRuntime });
        });
      }),
  );
}
