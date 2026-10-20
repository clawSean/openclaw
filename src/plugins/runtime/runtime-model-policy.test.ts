import { describe, expect, it } from "vitest";
import {
  assertAllowedCompletionModel,
  assertAllowedModelOverride,
  assertAllowedPluginOwnedModelAuthority,
  resolveAuthorityModelPolicy,
  resolvePluginLlmPolicy,
} from "./runtime-model-policy.js";

describe("shared runtime model policy", () => {
  it.each(["completion", "override"] as const)(
    "intersects independent host/plugin %s restrictions, including wildcard grants",
    (kind) => {
      const policy = (models: string[]) =>
        resolveAuthorityModelPolicy({
          allowModelOverride: true,
          allowedModels: models,
          allowedCompletionModels: models,
        });
      const check = (host: string[], plugin: string[]) => {
        const params = {
          resolvedModelRef: "fixture/selected",
          pluginPolicyId: "consumer",
          authorityPolicy: policy(host),
          pluginPolicy: policy(plugin),
        };
        return kind === "completion"
          ? assertAllowedCompletionModel(params)
          : assertAllowedModelOverride(params);
      };
      expect(() => check(["*"], ["fixture/other"])).toThrow("not allowlisted");
      expect(() => check(["fixture/other"], ["*"])).toThrow("not allowlisted");
      expect(() => check(["*"], [])).toThrow("no valid models");
      expect(() => check(["fixture/selected"], ["*"])).not.toThrow();
    },
  );

  it.each([
    { name: "missing opt-in", llm: { allowedCompletionModels: ["fixture/selected"] } },
    {
      name: "wildcard allowlist",
      llm: { allowPluginOwnedModelAuthority: true, allowedCompletionModels: ["*"] },
    },
    {
      name: "empty allowlist",
      llm: { allowPluginOwnedModelAuthority: true, allowedCompletionModels: [] },
    },
  ])("rejects plugin-owned authority with $name", ({ llm }) => {
    const pluginPolicy = resolvePluginLlmPolicy(
      { plugins: { entries: { mailreef: { llm } } } },
      "mailreef",
    );
    expect(() =>
      assertAllowedPluginOwnedModelAuthority({ pluginPolicyId: "mailreef", pluginPolicy }),
    ).toThrow();
  });

  it("accepts plugin-owned authority with an exact completion allowlist", () => {
    const pluginPolicy = resolvePluginLlmPolicy(
      {
        plugins: {
          entries: {
            mailreef: {
              llm: {
                allowPluginOwnedModelAuthority: true,
                allowedCompletionModels: ["fixture/selected"],
              },
            },
          },
        },
      },
      "mailreef",
    );
    expect(() =>
      assertAllowedPluginOwnedModelAuthority({ pluginPolicyId: "mailreef", pluginPolicy }),
    ).not.toThrow();
  });
});
