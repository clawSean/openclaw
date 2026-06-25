// Qa Lab tests cover live timeout plugin behavior.
import { describe, expect, it } from "vitest";
import { resolveQaLiveAgentTurnTimeoutMs, resolveQaLiveTurnTimeoutMs } from "./live-timeout.js";

function withLiveTurnTimeoutEnv<T>(value: string | undefined, run: () => T): T {
  const previous = process.env.OPENCLAW_QA_LIVE_TURN_TIMEOUT_MS;
  try {
    if (value === undefined) {
      delete process.env.OPENCLAW_QA_LIVE_TURN_TIMEOUT_MS;
    } else {
      process.env.OPENCLAW_QA_LIVE_TURN_TIMEOUT_MS = value;
    }
    return run();
  } finally {
    if (previous === undefined) {
      delete process.env.OPENCLAW_QA_LIVE_TURN_TIMEOUT_MS;
    } else {
      process.env.OPENCLAW_QA_LIVE_TURN_TIMEOUT_MS = previous;
    }
  }
}

describe("qa live timeout policy", () => {
  it.each([
    {
      title: "keeps mock lanes on the caller fallback",
      mode: "mock-openai",
      model: "anthropic/claude-sonnet-4-6",
      fallbackModel: "anthropic/claude-opus-4-8",
      expectedTimeoutMs: 30_000,
    },
    {
      title: "uses the higher gpt-5 live floor for openai heavy turns",
      mode: "live-frontier",
      model: "openai/gpt-5.6-luna",
      fallbackModel: "openai/gpt-5.6-luna",
      expectedTimeoutMs: 360_000,
    },
    {
      title: "keeps the standard live floor for other non-anthropic models",
      mode: "live-frontier",
      model: "google/gemini-3-flash",
      fallbackModel: "google/gemini-3-flash",
      expectedTimeoutMs: 120_000,
    },
    {
      title: "uses the anthropic floor for sonnet turns",
      mode: "live-frontier",
      model: "anthropic/claude-sonnet-4-6",
      fallbackModel: "anthropic/claude-opus-4-8",
      expectedTimeoutMs: 180_000,
    },
    {
      title: "uses the anthropic floor for claude-cli sonnet turns",
      mode: "live-frontier",
      model: "claude-cli/claude-sonnet-4-6",
      fallbackModel: "claude-cli/claude-opus-4-8",
      expectedTimeoutMs: 180_000,
    },
    {
      title: "uses the opus floor for claude-cli opus turns",
      mode: "live-frontier",
      model: "claude-cli/claude-opus-4-8",
      fallbackModel: "claude-cli/claude-opus-4-8",
      expectedTimeoutMs: 240_000,
    },
  ] as const)("$title", ({ mode, model, fallbackModel, expectedTimeoutMs }) => {
    expect(
      resolveQaLiveTurnTimeoutMs(
        {
          providerMode: mode,
          primaryModel: model,
          alternateModel: fallbackModel,
        },
        30_000,
      ),
    ).toBe(expectedTimeoutMs);
  });

  it("uses the opus floor when the switched turn runs on claude opus", () => {
    expect(
      resolveQaLiveTurnTimeoutMs(
        {
          providerMode: "live-frontier",
          primaryModel: "anthropic/claude-sonnet-4-6",
          alternateModel: "anthropic/claude-opus-4-8",
        },
        30_000,
        "anthropic/claude-opus-4-8",
      ),
    ).toBe(240_000);
  });

  it("allows live frontier runs to raise the turn timeout floor with an env override", () => {
    withLiveTurnTimeoutEnv("420000", () => {
      expect(
        resolveQaLiveAgentTurnTimeoutMs(
          {
            providerMode: "live-frontier",
            primaryModel: "google/gemini-3-flash",
            alternateModel: "google/gemini-3-flash",
          },
          30_000,
        ),
      ).toBe(420_000);
    });
  });

  it.each(["mock-openai", "aimock"] as const)(
    "does not apply the live turn timeout env override to %s lanes",
    (providerMode) => {
      withLiveTurnTimeoutEnv("420000", () => {
        expect(
          resolveQaLiveAgentTurnTimeoutMs(
            {
              providerMode,
              primaryModel: "google/gemini-3-flash",
              alternateModel: "google/gemini-3-flash",
            },
            180_000,
          ),
        ).toBe(180_000);
      });
    },
  );

  it("does not let lower env override values shorten generic live-frontier fallbacks", () => {
    withLiveTurnTimeoutEnv("45000", () => {
      expect(
        resolveQaLiveAgentTurnTimeoutMs(
          {
            providerMode: "live-frontier",
            primaryModel: "google/gemini-3-flash",
            alternateModel: "google/gemini-3-flash",
          },
          180_000,
        ),
      ).toBe(180_000);
    });
  });

  it("keeps provider floors when the live turn timeout env override is lower", () => {
    withLiveTurnTimeoutEnv("45000", () => {
      expect(
        resolveQaLiveAgentTurnTimeoutMs(
          {
            providerMode: "live-frontier",
            primaryModel: "openai/gpt-5.5",
            alternateModel: "openai/gpt-5.5",
          },
          30_000,
        ),
      ).toBe(360_000);
    });
  });

  it("ignores invalid live turn timeout env override values", () => {
    withLiveTurnTimeoutEnv("1e3", () => {
      expect(
        resolveQaLiveAgentTurnTimeoutMs(
          {
            providerMode: "live-frontier",
            primaryModel: "google/gemini-3-flash",
            alternateModel: "google/gemini-3-flash",
          },
          30_000,
        ),
      ).toBe(120_000);
    });
  });

  it("keeps control-plane timeouts independent from the turn override", () => {
    withLiveTurnTimeoutEnv("420000", () => {
      expect(
        resolveQaLiveTurnTimeoutMs(
          {
            providerMode: "live-frontier",
            primaryModel: "google/gemini-3-flash",
            alternateModel: "google/gemini-3-flash",
          },
          30_000,
        ),
      ).toBe(120_000);
    });
  });
});
