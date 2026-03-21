import { Command } from "commander";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const reportCommand = vi.fn();
const runtime = {
  log: vi.fn(),
  error: vi.fn(),
  exit: vi.fn(),
};

vi.mock("../../commands/report.js", () => ({
  reportCommand,
}));

vi.mock("../../runtime.js", () => ({
  defaultRuntime: runtime,
}));

let registerReportCommand: typeof import("./register.report.js").registerReportCommand;

beforeAll(async () => {
  ({ registerReportCommand } = await import("./register.report.js"));
});

describe("registerReportCommand", () => {
  async function runCli(args: string[]) {
    const program = new Command();
    registerReportCommand(program);
    await program.parseAsync(args, { from: "user" });
    return program;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    reportCommand.mockResolvedValue(undefined);
  });

  it("registers bug reports with probe mode", async () => {
    await runCli([
      "report",
      "bug",
      "--summary",
      "Gateway timeout",
      "--repro",
      "1. Start gateway",
      "--expected",
      "Model responds",
      "--actual",
      "Timeout",
      "--impact",
      "Blocks requests",
      "--previous-version",
      "2026.3.14",
      "--additional-information",
      "Worked last week behind mitmproxy.",
      "--probe",
      "gateway",
    ]);

    expect(reportCommand).toHaveBeenCalledWith({
      kind: "bug",
      options: expect.objectContaining({
        summary: "Gateway timeout",
        repro: "1. Start gateway",
        expected: "Model responds",
        actual: "Timeout",
        impact: "Blocks requests",
        previousVersion: "2026.3.14",
        additionalInformation: "Worked last week behind mitmproxy.",
        probe: "gateway",
      }),
      runtime,
    });
  });

  it("passes both additional-information and context through for merge handling", async () => {
    await runCli([
      "report",
      "feature",
      "--summary",
      "Need better retry visibility",
      "--problem",
      "Retries are opaque",
      "--solution",
      "Show retry state in UI",
      "--impact",
      "Reduces debugging time",
      "--additional-information",
      "Users noticed this after rollout.",
      "--context",
      "Might be related to proxy retries.",
    ]);

    expect(reportCommand).toHaveBeenCalledWith({
      kind: "feature",
      options: expect.objectContaining({
        additionalInformation: "Users noticed this after rollout.",
        context: "Might be related to proxy retries.",
      }),
      runtime,
    });
  });

  it("documents new report options and probe descriptions in help text", async () => {
    const program = new Command();
    registerReportCommand(program);
    const report = program.commands.find((command) => command.name() === "report");
    const help =
      report?.commands.find((command) => command.name() === "bug")?.helpInformation() ?? "";

    expect(help).toContain("--non-interactive");
    expect(help).toContain("--previous-version");
    expect(help).toContain("--additional-information");
    expect(help).toContain("general=runtime+proxy");
    expect(help).toContain("model=auth/live check");
  });

  it("registers security reports without public probe options", async () => {
    await runCli([
      "report",
      "security",
      "--title",
      "Token leak",
      "--severity",
      "high",
      "--impact",
      "Credential exposure",
      "--component",
      "Gateway auth",
      "--reproduction",
      "Run startup",
      "--demonstrated-impact",
      "Token printed",
      "--environment",
      "macOS",
      "--remediation",
      "Mask logs",
    ]);

    expect(reportCommand).toHaveBeenCalledWith({
      kind: "security",
      options: expect.objectContaining({
        title: "Token leak",
        severity: "high",
        component: "Gateway auth",
        remediation: "Mask logs",
      }),
      runtime,
    });
  });
});
