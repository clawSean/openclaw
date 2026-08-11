import { beforeEach, describe, expect, it, vi } from "vitest";

const readProviderUsageProfileMock = vi.fn();

const store = {
  profiles: {
    "openai:personal": { type: "oauth", provider: "openai" },
    "openai:work": { type: "oauth", provider: "openai" },
    "openai:excluded": { type: "oauth", provider: "openai" },
    "claude-cli:default": { type: "oauth", provider: "claude-cli" },
    "anthropic:api": { type: "api_key", provider: "anthropic" },
    "deepseek:work": { type: "api_key", provider: "deepseek" },
    "openrouter:work": { type: "api_key", provider: "openrouter" },
  },
};

vi.mock("../agents/auth-profiles.js", () => ({
  dedupeProfileIds: (ids: string[]) => [...new Set(ids)],
  ensureAuthProfileStoreWithoutExternalProfiles: () => store,
  resolveAuthProfileOrder: ({ provider }: { provider: string }) =>
    provider === "openai"
      ? ["openai:personal", "openai:work"]
      : provider === "claude-cli"
        ? ["claude-cli:default"]
        : provider === "anthropic"
          ? ["anthropic:api"]
          : provider === "deepseek"
            ? ["deepseek:work"]
            : provider === "openrouter"
              ? ["openrouter:work"]
              : [],
}));

vi.mock("./provider-usage.auth.js", () => ({
  resolveProviderAuths: async () => [],
}));

vi.mock("./provider-usage.profile.js", () => ({
  readProviderUsageProfile: (...args: unknown[]) => readProviderUsageProfileMock(...args),
}));

import { loadProviderUsageSummary } from "./provider-usage.load.js";

describe("provider usage profile discovery", () => {
  beforeEach(() => {
    readProviderUsageProfileMock.mockReset();
    readProviderUsageProfileMock.mockImplementation(
      async ({ providerId, authProfileId }: { providerId: string; authProfileId: string }) => ({
        provider: providerId,
        authProfileId,
        capturedAt: 1,
        displayName: providerId,
        windows: [],
      }),
    );
  });

  it("returns every eligible ordered profile and normalizes usage-owner aliases", async () => {
    const result = await loadProviderUsageSummary({
      providers: ["openai", "anthropic"],
      config: {},
      fetch: vi.fn(),
    });

    expect(readProviderUsageProfileMock.mock.calls.map(([request]) => request)).toEqual([
      expect.objectContaining({ providerId: "openai", authProfileId: "openai:personal" }),
      expect.objectContaining({ providerId: "openai", authProfileId: "openai:work" }),
      expect.objectContaining({ providerId: "anthropic", authProfileId: "claude-cli:default" }),
    ]);
    expect(result.profiles).toEqual(
      [
        { provider: "openai", authProfileId: "openai:personal" },
        { provider: "openai", authProfileId: "openai:work" },
        { provider: "anthropic", authProfileId: "claude-cli:default" },
      ].map((profile) => expect.objectContaining(profile)),
    );
  });

  it("does not include profiles outside the requested usage providers", async () => {
    const result = await loadProviderUsageSummary({
      providers: ["anthropic"],
      config: {},
      fetch: vi.fn(),
    });

    expect(readProviderUsageProfileMock).toHaveBeenCalledOnce();
    expect(readProviderUsageProfileMock).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: "anthropic",
        authProfileId: "claude-cli:default",
      }),
      expect.any(Object),
    );
    expect(result.profiles).toEqual([
      expect.objectContaining({
        provider: "anthropic",
        authProfileId: "claude-cli:default",
      }),
    ]);
  });

  it("loads API-key profiles only for explicitly allowlisted providers", async () => {
    const result = await loadProviderUsageSummary({
      providers: ["anthropic", "deepseek", "openrouter"],
      config: {},
      fetch: vi.fn(),
    });

    expect(readProviderUsageProfileMock.mock.calls.map(([request]) => request)).toEqual([
      expect.objectContaining({ providerId: "anthropic", authProfileId: "claude-cli:default" }),
      expect.objectContaining({ providerId: "deepseek", authProfileId: "deepseek:work" }),
    ]);
    expect(result.profiles).toEqual(
      [
        { provider: "anthropic", authProfileId: "claude-cli:default" },
        { provider: "deepseek", authProfileId: "deepseek:work" },
      ].map((profile) => expect.objectContaining(profile)),
    );
  });
});
