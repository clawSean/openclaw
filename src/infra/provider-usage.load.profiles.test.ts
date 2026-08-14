import { beforeEach, describe, expect, it, vi } from "vitest";

const readProviderUsageProfileMock = vi.fn();
const ensureAuthProfileStoreMock = vi.fn();
const externalCliDiscoveryForProvidersMock = vi.fn(
  ({ cfg, providers }: { cfg: unknown; providers: Iterable<string> }) => ({
    mode: "scoped" as const,
    allowKeychainPrompt: false as const,
    config: cfg,
    providerIds: providers,
  }),
);

const store = {
  profiles: {
    "openai:personal": { type: "oauth", provider: "openai" },
    "openai:work": { type: "oauth", provider: "openai" },
    "openai:external": { type: "oauth", provider: "openai" },
    "openai:excluded": { type: "oauth", provider: "openai" },
    "claude-cli:default": { type: "oauth", provider: "claude-cli" },
    "anthropic:api": { type: "api_key", provider: "anthropic" },
    "deepseek:work": { type: "api_key", provider: "deepseek" },
    "openrouter:work": { type: "api_key", provider: "openrouter" },
  },
};

vi.mock("../agents/auth-profiles.js", () => ({
  dedupeProfileIds: (ids: string[]) => [...new Set(ids)],
  ensureAuthProfileStore: (...args: unknown[]) => ensureAuthProfileStoreMock(...args),
  externalCliDiscoveryForProviders: (params: { cfg: unknown; providers: Iterable<string> }) =>
    externalCliDiscoveryForProvidersMock(params),
  resolveAuthProfileOrder: ({ provider }: { provider: string }) =>
    provider === "openai"
      ? ["openai:personal", "openai:work", "openai:external"]
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

vi.mock("../plugins/provider-runtime.js", () => ({
  listProviderUsagePluginDescriptors: () => [
    {
      provider: "anthropic",
      displayName: "Claude",
      profileProviderIds: ["anthropic", "claude-cli"],
      profileCredentialTypes: ["oauth", "token"],
    },
    {
      provider: "deepseek",
      displayName: "DeepSeek",
      profileProviderIds: ["deepseek"],
      profileCredentialTypes: ["oauth", "token", "api_key"],
    },
    {
      provider: "openrouter",
      displayName: "OpenRouter",
      profileProviderIds: ["openrouter"],
      profileCredentialTypes: ["oauth", "token"],
    },
  ],
  resolveProviderUsageSnapshotWithPlugin: async () => null,
}));

vi.mock("./provider-usage.profile.js", () => ({
  readProviderUsageProfile: (...args: unknown[]) => readProviderUsageProfileMock(...args),
}));

import { loadProviderUsageSummary } from "./provider-usage.load.js";

describe("provider usage profile discovery", () => {
  beforeEach(() => {
    ensureAuthProfileStoreMock.mockReset().mockReturnValue(store);
    externalCliDiscoveryForProvidersMock.mockClear();
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
      providers: ["openai", "anthropic", "claude-cli"],
      config: {},
      fetch: vi.fn(),
    });

    expect(readProviderUsageProfileMock.mock.calls.map(([request]) => request)).toEqual([
      expect.objectContaining({ providerId: "openai", authProfileId: "openai:personal" }),
      expect.objectContaining({ providerId: "openai", authProfileId: "openai:work" }),
      expect.objectContaining({ providerId: "openai", authProfileId: "openai:external" }),
      expect.objectContaining({ providerId: "anthropic", authProfileId: "claude-cli:default" }),
    ]);
    expect(result.profiles).toEqual(
      [
        { provider: "openai", authProfileId: "openai:personal" },
        { provider: "openai", authProfileId: "openai:work" },
        { provider: "openai", authProfileId: "openai:external" },
        { provider: "anthropic", authProfileId: "claude-cli:default" },
      ].map((profile) => expect.objectContaining(profile)),
    );
    expect(externalCliDiscoveryForProvidersMock).toHaveBeenCalledWith({
      cfg: {},
      providers: ["openai", "anthropic", "claude-cli"],
      allowKeychainPrompt: false,
    });
    expect(ensureAuthProfileStoreMock).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({
        allowKeychainPrompt: false,
        readOnly: true,
        syncExternalCli: false,
        externalCli: expect.objectContaining({ mode: "scoped" }),
      }),
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
