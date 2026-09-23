import path from "node:path";
import { expect, it } from "vitest";
import {
  loadSessionEntryReadOnly,
  replaceSessionEntry,
} from "../config/sessions/session-accessor.js";
import { projectSessionsPatchEntry } from "../gateway/sessions-patch.js";
import type { createModelSelectionInputs } from "./apply-session-model-selection.test-support.js";

type Inputs = ReturnType<typeof createModelSelectionInputs>;

export function registerModelSelectionRuntimeCases(params: {
  applySessionModelSelection: typeof import("./apply-session-model-selection.js").applySessionModelSelection;
  effects: { mutateConfigFileWithRetry: unknown };
  inputs: Inputs;
  tempDirs: { make(prefix: string): string };
}): void {
  const { applySessionModelSelection, effects, inputs, tempDirs } = params;
  const { catalog, createEntry, createParams } = inputs;

  it.each([undefined, "codex"])(
    "clears inherited but rejects explicit Gateway runtime %s",
    async (agentRuntime) => {
      const sessionEntry = createEntry({
        providerOverride: "openai",
        modelOverride: "gpt-4o",
        agentRuntimeOverride: "codex",
        nativeRuntimeConsent: "codex",
      });
      const { cfg, sessionKey } = createParams({ sessionEntry });
      const initial = structuredClone(sessionEntry);
      const result = await projectSessionsPatchEntry({
        cfg,
        storeKey: sessionKey,
        existingEntry: sessionEntry,
        isLabelInUse: () => false,
        patch: {
          key: sessionKey,
          model: "anthropic/claude-opus-4-6",
          ...(agentRuntime ? { agentRuntime } : {}),
        },
        loadGatewayModelCatalogSnapshot: async () => ({ entries: catalog, routeVariants: catalog }),
      });
      if (agentRuntime) {
        expect(result).toMatchObject({
          ok: false,
          error: { message: expect.stringContaining('Runtime "codex" is not supported') },
        });
      } else {
        expect(result.ok).toBe(true);
        if (!result.ok) {
          throw new Error("Model switch failed");
        }
        expect(result.entry.agentRuntimeOverride).toBeUndefined();
        expect(result.entry.nativeRuntimeConsent).toBeUndefined();
        expect(result.entry).toMatchObject({
          providerOverride: "anthropic",
          modelOverride: "claude-opus-4-6",
        });
      }
      expect(sessionEntry).toEqual(initial);
    },
  );

  it.each([undefined, "openclaw", "claude-cli"])(
    "persists SDK model-only selection with inherited runtime %s",
    async (agentRuntimeOverride) => {
      const tempRoot = tempDirs.make("openclaw-model-picker-runtime-");
      const storePath = path.join(tempRoot, "sessions.json");
      const sessionKey = "agent:main:dm:runtime-compat";
      const sessionEntry = createEntry({
        providerOverride: "anthropic",
        modelOverride: "claude-opus-4-6",
        ...(agentRuntimeOverride
          ? { agentRuntimeOverride, nativeRuntimeConsent: agentRuntimeOverride }
          : {}),
      });
      await replaceSessionEntry({ sessionKey, storePath }, sessionEntry);
      const result = await applySessionModelSelection(
        createParams({
          cfg: {
            agents: {
              defaults: { models: { "openai/gpt-4o": { agentRuntime: { id: "openclaw" } } } },
            },
          },
          sessionEntry,
          sessionKey,
          storePath,
        }),
      );
      expect(result).toMatchObject({
        status: "applied",
        provider: "openai",
        model: "gpt-4o",
        agentRuntime: "openclaw",
      });
      const stored = loadSessionEntryReadOnly({ sessionKey, storePath });
      expect(stored).toMatchObject({ providerOverride: "openai", modelOverride: "gpt-4o" });
      const compatible = agentRuntimeOverride === "openclaw";
      expect(stored?.agentRuntimeOverride).toBe(compatible ? "openclaw" : undefined);
      expect(stored?.nativeRuntimeConsent).toBe(compatible ? "openclaw" : undefined);
      expect(effects.mutateConfigFileWithRetry).not.toHaveBeenCalled();
    },
  );
}
