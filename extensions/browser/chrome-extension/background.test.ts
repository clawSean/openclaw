import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanupBackgroundHarnesses,
  loadBackground,
  TEST_RELAY_KEY,
  REPLACEMENT_TEST_RELAY_KEY,
  sendRuntimeMessage,
} from "./background.test-harness.js";
import type { RetiredStorageFailureStage } from "./background.test-harness.js";

function nativeSuccess(request: unknown, secret = TEST_RELAY_KEY) {
  const nonce = (request as { nonce?: unknown }).nonce;
  return {
    v: 1,
    ok: true,
    nonce,
    pairingString: `ws://127.0.0.1:18789/browser/extension?gateway=ws%3A%2F%2F127.0.0.1%3A18789#${secret}`,
  };
}

describe("native extension bootstrap", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(async () => {
    await cleanupBackgroundHarnesses();
    vi.unstubAllGlobals();
  });

  it("keeps an existing manual pairing without contacting the native host", async () => {
    const harness = await loadBackground();

    expect(harness.sendNativeMessage).not.toHaveBeenCalled();
    expect(harness.relaySockets).toHaveLength(1);
  });

  it("records host-not-found as retryable without claiming same-process recovery", async () => {
    const harness = await loadBackground({
      storedConfig: {},
      nativeMessage: async () => {
        throw new Error("Specified native messaging host not found.");
      },
    });
    await vi.waitFor(() => {
      expect(harness.storageValues).toMatchObject({
        nativeBootstrapState: "retrying",
        nativeBootstrapFailureCode: "host_not_found",
      });
    });

    await sendRuntimeMessage(harness, { type: "getStatus" });
    await sendRuntimeMessage(harness, { type: "getStatus" });
    expect(harness.sendNativeMessage).toHaveBeenCalledOnce();

    harness.alarmListener({ name: "openclaw-relay-watchdog" });

    await vi.waitFor(() => expect(harness.sendNativeMessage).toHaveBeenCalledTimes(2));
    expect(harness.storageValues).not.toHaveProperty("relayUrl");
  });

  it("recovers after a repaired manifest only when automatic setup is explicitly enabled again", async () => {
    let repaired = false;
    const harness = await loadBackground({
      storedConfig: {},
      nativeMessage: async (request) =>
        repaired ? nativeSuccess(request) : { v: 1, ok: false, code: "manifest_invalid" },
    });
    await vi.waitFor(() =>
      expect(harness.storageValues).toMatchObject({
        nativeBootstrapState: "manual_required",
        nativeBootstrapFailureCode: "manifest_invalid",
      }),
    );
    repaired = true;
    harness.alarmListener({ name: "openclaw-relay-watchdog" });
    await sendRuntimeMessage(harness, { type: "getStatus" });
    expect(harness.sendNativeMessage).toHaveBeenCalledOnce();
    expect(harness.relaySockets).toHaveLength(0);
    await expect(
      sendRuntimeMessage(harness, { type: "setNativeBootstrapEnabled", enabled: true }),
    ).resolves.toMatchObject({ ok: true });
    await vi.waitFor(() => expect(harness.relaySockets).toHaveLength(1));
    expect(harness.storageValues).toMatchObject({
      nativeBootstrapState: "ready",
      pairingSource: "native",
    });
    expect(harness.storageValues).not.toHaveProperty("nativeBootstrapDisabled");
    expect(harness.storageValues).not.toHaveProperty("nativeBootstrapFailureCode");
    expect(harness.sendNativeMessage).toHaveBeenCalledTimes(2);
    await expect(sendRuntimeMessage(harness, { type: "getStatus" })).resolves.toMatchObject({
      nativeBootstrap: { automaticSetupLocked: false, disabled: false, state: "ready" },
    });
    harness.alarmListener({ name: "openclaw-relay-watchdog" });
    await Promise.resolve();
    expect(harness.storageValues).not.toHaveProperty("nativeBootstrapDisabled");
  });

  it("coalesces startup and watchdog while popup status remains read-only", async () => {
    let resolveNative = (_value: unknown) => {};
    const pending = new Promise((resolve) => {
      resolveNative = resolve;
    });
    const harness = await loadBackground({
      storedConfig: {},
      nativeMessage: async (request) => {
        const response = await pending;
        return response ?? nativeSuccess(request);
      },
    });
    harness.alarmListener({ name: "openclaw-relay-watchdog" });
    await sendRuntimeMessage(harness, { type: "getStatus" });
    await sendRuntimeMessage(harness, { type: "getStatus" });

    expect(harness.sendNativeMessage).toHaveBeenCalledOnce();
    const request = harness.sendNativeMessage.mock.calls[0]?.[1];
    resolveNative(nativeSuccess(request));
    await vi.waitFor(() => expect(harness.relaySockets).toHaveLength(1));
    expect(harness.sendNativeMessage).toHaveBeenCalledOnce();
  });

  it("starts a fresh explicit local attempt while an older generation is pending", async () => {
    let resolveOldNative = (_value: unknown) => {};
    let oldRequest: unknown;
    let callCount = 0;
    const harness = await loadBackground({
      storedConfig: {},
      nativeMessage: async (request) => {
        callCount += 1;
        if (callCount === 1) {
          oldRequest = request;
          return await new Promise((resolve) => {
            resolveOldNative = resolve;
          });
        }
        return nativeSuccess(request, REPLACEMENT_TEST_RELAY_KEY);
      },
    });

    await expect(
      sendRuntimeMessage(harness, { type: "setNativeBootstrapEnabled", enabled: true }),
    ).resolves.toMatchObject({ ok: true, result: { status: "paired" } });
    expect(harness.sendNativeMessage).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(harness.relaySockets).toHaveLength(1));
    expect(harness.storageValues).toMatchObject({
      pairingSource: "native",
      token: REPLACEMENT_TEST_RELAY_KEY,
      nativeBootstrapState: "ready",
    });

    resolveOldNative(nativeSuccess(oldRequest));
    await Promise.resolve();
    expect(harness.storageValues).toMatchObject({
      pairingSource: "native",
      token: REPLACEMENT_TEST_RELAY_KEY,
      nativeBootstrapState: "ready",
    });
    expect(harness.relaySockets).toHaveLength(1);
  });

  it("lets unpair supersede an older local-setup request before it reaches bootstrap", async () => {
    const harness = await loadBackground({
      storedConfig: { nativeBootstrapDisabled: true, nativeBootstrapState: "disabled" },
    });
    const readsBeforeEnable = harness.storageGet.mock.calls.length;
    const releaseEnableRead = harness.deferNextStorageGet();

    const enable = sendRuntimeMessage(harness, {
      type: "setNativeBootstrapEnabled",
      enabled: true,
    });
    await vi.waitFor(() =>
      expect(harness.storageGet.mock.calls.length).toBeGreaterThan(readsBeforeEnable),
    );
    const unpair = sendRuntimeMessage(harness, { type: "unpair" });
    releaseEnableRead();

    await expect(enable).resolves.toEqual({
      ok: false,
      error: "Automatic setup request was superseded by a newer pairing request.",
    });
    await expect(unpair).resolves.toEqual({ ok: true });
    expect(harness.storageValues).toMatchObject({
      nativeBootstrapDisabled: true,
      nativeBootstrapState: "disabled",
    });
    expect(harness.storageValues).not.toHaveProperty("relayUrl");
    expect(harness.sendNativeMessage).not.toHaveBeenCalled();
    expect(harness.relaySockets).toHaveLength(0);
  });

  it("does not overwrite a manual pairing that wins a native response race", async () => {
    let resolveNative = (_value: unknown) => {};
    let request: unknown;
    const harness = await loadBackground({
      storedConfig: {},
      nativeMessage: async (value) => {
        request = value;
        return await new Promise((resolve) => {
          resolveNative = resolve;
        });
      },
    });

    await expect(
      sendRuntimeMessage(harness, {
        type: "pair",
        pairingString: `wss://gateway.example.com/browser/extension#${REPLACEMENT_TEST_RELAY_KEY}`,
        accessMode: "selected",
      }),
    ).resolves.toEqual({ ok: true });
    resolveNative(nativeSuccess(request));

    await vi.waitFor(() => expect(harness.relaySockets).toHaveLength(1));
    expect(harness.storageValues).toMatchObject({
      relayUrl: "wss://gateway.example.com/browser/extension",
      token: REPLACEMENT_TEST_RELAY_KEY,
      accessMode: "selected",
      nativeBootstrapDisabled: true,
      nativeBootstrapState: "disabled",
      pairingSource: "manual",
    });
    expect(harness.sendNativeMessage).toHaveBeenCalledOnce();
  });

  it("does not overwrite manual bootstrap state when a canceled native call rejects", async () => {
    let rejectNative = (_error: Error) => {};
    const harness = await loadBackground({
      storedConfig: {},
      nativeMessage: async () =>
        await new Promise((_resolve, reject) => {
          rejectNative = reject;
        }),
    });

    await expect(
      sendRuntimeMessage(harness, {
        type: "pair",
        pairingString: `wss://gateway.example.com/browser/extension#${REPLACEMENT_TEST_RELAY_KEY}`,
        accessMode: "selected",
      }),
    ).resolves.toEqual({ ok: true });
    rejectNative(new Error("Specified native messaging host not found."));

    await vi.waitFor(() =>
      expect(harness.storageValues).toMatchObject({
        nativeBootstrapDisabled: true,
        nativeBootstrapState: "disabled",
        pairingSource: "manual",
      }),
    );
    expect(harness.storageValues).not.toHaveProperty("nativeBootstrapFailureCode");
  });

  it("invalidates a pending native pairing before manual pairing preflight yields", async () => {
    let resolveNative = (_value: unknown) => {};
    let request: unknown;
    const harness = await loadBackground({
      storedConfig: {},
      nativeMessage: async (value) => {
        request = value;
        return await new Promise((resolve) => {
          resolveNative = resolve;
        });
      },
    });
    const readsBeforeManualPairing = harness.storageGet.mock.calls.length;
    const releaseManualPreflight = harness.deferNextStorageGet();

    const manualPairing = sendRuntimeMessage(harness, {
      type: "pair",
      pairingString: `wss://gateway.example.com/browser/extension#${REPLACEMENT_TEST_RELAY_KEY}`,
      accessMode: "selected",
    });
    await vi.waitFor(() =>
      expect(harness.storageGet.mock.calls.length).toBeGreaterThan(readsBeforeManualPairing),
    );
    resolveNative(nativeSuccess(request));
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    releaseManualPreflight();

    await expect(manualPairing).resolves.toEqual({ ok: true });
    await vi.waitFor(() => expect(harness.relaySockets).toHaveLength(1));
    expect(harness.storageValues).toMatchObject({
      relayUrl: "wss://gateway.example.com/browser/extension",
      token: REPLACEMENT_TEST_RELAY_KEY,
      accessMode: "selected",
      nativeBootstrapDisabled: true,
      nativeBootstrapState: "disabled",
      pairingSource: "manual",
    });
  });

  it("unpair disables bootstrap before a late native response can re-pair", async () => {
    let resolveNative = (_value: unknown) => {};
    let request: unknown;
    const harness = await loadBackground({
      storedConfig: {},
      nativeMessage: async (value) => {
        request = value;
        return await new Promise((resolve) => {
          resolveNative = resolve;
        });
      },
    });

    await expect(sendRuntimeMessage(harness, { type: "unpair" })).resolves.toEqual({ ok: true });
    expect(harness.storageValues.nativeBootstrapDisabled).toBe(true);
    resolveNative(nativeSuccess(request));
    await Promise.resolve();
    await Promise.resolve();

    expect(harness.storageValues).not.toHaveProperty("relayUrl");
    expect(harness.relaySockets).toHaveLength(0);
  });

  it("lets immediate unpair supersede pairing before access preflight", async () => {
    const harness = await loadBackground({ deferTabAccessInitialization: true });
    const pairing = sendRuntimeMessage(harness, {
      type: "pair",
      pairingString: `wss://gateway.example.com/browser/extension#${REPLACEMENT_TEST_RELAY_KEY}`,
      accessMode: "selected",
    });
    const unpairing = sendRuntimeMessage(harness, { type: "unpair" });

    await vi.waitFor(() => expect(harness.storageValues.nativeBootstrapDisabled).toBe(true));
    harness.releaseTabAccessInitialization();

    await expect(pairing).resolves.toMatchObject({
      ok: false,
      error: "Pairing was superseded by a newer request.",
    });
    await expect(unpairing).resolves.toEqual({ ok: true });
    expect(harness.storageValues).not.toHaveProperty("relayUrl");
    expect(harness.relaySockets).toHaveLength(0);
  });

  it("keeps automatic local bootstrap disabled after manual pairing", async () => {
    const harness = await loadBackground({
      storedConfig: { nativeBootstrapDisabled: true, nativeBootstrapState: "disabled" },
    });
    expect(harness.sendNativeMessage).not.toHaveBeenCalled();

    await expect(
      sendRuntimeMessage(harness, {
        type: "pair",
        pairingString: `wss://gateway.example.com/browser/extension#${REPLACEMENT_TEST_RELAY_KEY}`,
      }),
    ).resolves.toEqual({ ok: true });
    expect(harness.storageValues).toMatchObject({
      nativeBootstrapDisabled: true,
      nativeBootstrapState: "disabled",
    });

    await expect(sendRuntimeMessage(harness, { type: "getStatus" })).resolves.toMatchObject({
      paired: true,
      nativeBootstrap: { disabled: true, state: "ready", automaticSetupLocked: true },
    });
    await expect(
      sendRuntimeMessage(harness, { type: "setNativeBootstrapEnabled", enabled: true }),
    ).resolves.toEqual({
      ok: false,
      error: "Forget the manual pairing before using automatic local setup.",
    });
    harness.alarmListener({ name: "openclaw-relay-watchdog" });
    await Promise.resolve();
    expect(harness.storageValues).toMatchObject({
      nativeBootstrapDisabled: true,
      nativeBootstrapState: "disabled",
    });
    expect(harness.sendNativeMessage).not.toHaveBeenCalled();
  });

  it("migrates an existing remote pairing to manual authority on startup", async () => {
    const harness = await loadBackground({
      storedConfig: {
        relayUrl: "wss://gateway.example.com/browser/extension",
        token: REPLACEMENT_TEST_RELAY_KEY,
        authVersion: 2,
        accessMode: "selected",
        groupColor: "orange",
      },
    });

    await vi.waitFor(() =>
      expect(harness.storageValues).toMatchObject({
        nativeBootstrapDisabled: true,
        nativeBootstrapState: "disabled",
        pairingSource: "manual",
      }),
    );
    expect(harness.sendNativeMessage).not.toHaveBeenCalled();
    await expect(sendRuntimeMessage(harness, { type: "getStatus" })).resolves.toMatchObject({
      paired: true,
      nativeBootstrap: { automaticSetupLocked: true },
    });
  });

  it("keeps a legacy native local Gateway pairing under automatic bootstrap authority", async () => {
    const harness = await loadBackground({
      storedConfig: {
        relayUrl: "ws://127.0.0.1:18789/browser/extension",
        gatewayUrl: "ws://127.0.0.1:18789",
        token: REPLACEMENT_TEST_RELAY_KEY,
        authVersion: 2,
        accessMode: "selected",
        groupColor: "orange",
      },
    });

    await expect(sendRuntimeMessage(harness, { type: "getStatus" })).resolves.toMatchObject({
      paired: true,
      nativeBootstrap: { automaticSetupLocked: false, disabled: false, state: "ready" },
    });
    expect(harness.storageValues.pairingSource).toBe("native");
    expect(harness.storageValues).not.toHaveProperty("nativeBootstrapDisabled");
    harness.alarmListener({ name: "openclaw-relay-watchdog" });
    await Promise.resolve();
    expect(harness.storageValues).not.toHaveProperty("nativeBootstrapDisabled");
  });

  it("fails closed on a malformed or nonce-mismatched response", async () => {
    const harness = await loadBackground({
      storedConfig: {},
      nativeMessage: async () => ({
        v: 1,
        ok: true,
        nonce: "wrong",
        pairingString: `ws://127.0.0.1:18797/extension#${TEST_RELAY_KEY}`,
      }),
    });
    await vi.waitFor(() => {
      expect(harness.storageValues).toMatchObject({
        nativeBootstrapState: "manual_required",
        nativeBootstrapFailureCode: "malformed_response",
      });
    });
    expect(harness.storageValues).not.toHaveProperty("relayUrl");
  });

  it("blocks every startup path while retired copilot custody is unresolved", async () => {
    const harness = await loadBackground({
      deferRetiredStatePreparation: true,
      inheritedDebuggerTabIds: [17],
      storedConfig: {
        relayUrl: "ws://127.0.0.1:18797/extension",
        token: TEST_RELAY_KEY,
        authVersion: 2,
        accessMode: "all",
        copilotSessionRegistryV1: {
          sessions: { 17: { creationPending: true } },
          pendingArchives: [],
        },
      },
    });

    harness.alarmListener({ name: "openclaw-relay-watchdog" });
    harness.startupListener();
    harness.installedListener();
    await Promise.resolve();
    expect(harness.sendNativeMessage).not.toHaveBeenCalled();
    expect(harness.relaySockets).toHaveLength(0);
    expect(harness.debuggerAttach).not.toHaveBeenCalled();

    harness.releaseRetiredStatePreparation();
    await vi.waitFor(() =>
      expect(harness.debuggerDetach).toHaveBeenCalledWith({ targetId: "tab-17" }),
    );
    expect(harness.sendNativeMessage).not.toHaveBeenCalled();
    expect(harness.relaySockets).toHaveLength(0);

    const status = await sendRuntimeMessage(harness, { type: "getStatus" });
    expect(status).toMatchObject({
      paired: true,
      retiredCopilotCustodyBlocked: true,
      accessibleTabCount: 0,
    });
    expect(JSON.stringify(status)).not.toMatch(/creationPending|pendingArchives|sessionKey/u);
    await expect(
      sendRuntimeMessage(harness, {
        type: "pair",
        pairingString: `ws://127.0.0.1:18798/extension#${REPLACEMENT_TEST_RELAY_KEY}`,
      }),
    ).resolves.toMatchObject({ ok: false });
    await expect(
      sendRuntimeMessage(harness, { type: "setNativeBootstrapEnabled", enabled: true }),
    ).resolves.toMatchObject({ ok: false });
    await expect(
      sendRuntimeMessage(harness, { type: "setAccessMode", accessMode: "selected" }),
    ).resolves.toMatchObject({ ok: false });
    await expect(
      sendRuntimeMessage(harness, {
        type: "toggleTabAccess",
        tabId: 17,
        accessMode: "all",
        grant: true,
      }),
    ).resolves.toMatchObject({ ok: false });
    expect(harness.storageValues).toMatchObject({
      relayUrl: "ws://127.0.0.1:18797/extension",
      accessMode: "all",
      copilotSessionRegistryV1: expect.any(Object),
    });
  });

  it("uses explicit Disconnect to discard custody before local setup can reconnect", async () => {
    const harness = await loadBackground({
      nativeMessage: async (request) => nativeSuccess(request),
      storedConfig: {
        relayUrl: "ws://127.0.0.1:18797/extension",
        token: TEST_RELAY_KEY,
        authVersion: 2,
        accessMode: "all",
        copilotSessionRegistryV1: {
          sessions: { 17: { creationPending: true } },
          pendingArchives: [],
        },
        copilotDeviceIdentitiesV1: { redacted: true },
        copilotDeviceTokensV1: { redacted: true },
      },
      sessionConfig: {
        copilotBrowserInstanceV1: "redacted",
        copilotPanelBindingsV1: { 17: "redacted" },
      },
    });

    await expect(sendRuntimeMessage(harness, { type: "unpair" })).resolves.toEqual({ ok: true });
    expect(harness.storageValues).not.toHaveProperty("relayUrl");
    expect(harness.storageValues).not.toHaveProperty("copilotSessionRegistryV1");
    expect(harness.sessionStorageValues).not.toHaveProperty("copilotBrowserInstanceV1");
    expect(harness.storageValues.nativeBootstrapDisabled).toBe(true);

    await expect(
      sendRuntimeMessage(harness, { type: "setNativeBootstrapEnabled", enabled: true }),
    ).resolves.toMatchObject({ ok: true });
    await vi.waitFor(() => expect(harness.relaySockets).toHaveLength(1));
    expect(harness.sendNativeMessage).toHaveBeenCalledOnce();
  });

  it.each<RetiredStorageFailureStage>([
    "marker_set",
    "session_remove",
    "retired_local_remove",
    "marker_remove",
  ])(
    "keeps custody blocked when Disconnect fails at %s and permits an explicit retry",
    async (stage) => {
      const harness = await loadBackground({
        inheritedDebuggerTabIds: [17],
        retiredStorageFailureStage: stage,
        storedConfig: {
          relayUrl: "ws://127.0.0.1:18797/extension",
          token: TEST_RELAY_KEY,
          authVersion: 2,
          accessMode: "all",
          copilotSessionRegistryV1: {
            sessions: { 17: { creationPending: true } },
            pendingArchives: [],
          },
        },
        sessionConfig: {
          copilotBrowserInstanceV1: "redacted",
          copilotPanelBindingsV1: { 17: "redacted" },
        },
      });

      await expect(sendRuntimeMessage(harness, { type: "unpair" })).resolves.toMatchObject({
        ok: false,
      });
      await expect(sendRuntimeMessage(harness, { type: "getStatus" })).resolves.toMatchObject({
        retiredCopilotCustodyBlocked: true,
      });
      expect(harness.relaySockets).toHaveLength(0);
      expect(harness.sendNativeMessage).not.toHaveBeenCalled();
      expect(harness.debuggerAttach).not.toHaveBeenCalled();
      if (stage === "marker_set") {
        expect(harness.storageValues).toHaveProperty("copilotSessionRegistryV1");
        expect(harness.storageValues).not.toHaveProperty("retiredCopilotCustodyBlockedV1");
      } else {
        expect(harness.storageValues.retiredCopilotCustodyBlockedV1).toBe(true);
      }
      if (stage === "session_remove" || stage === "retired_local_remove") {
        expect(harness.storageValues).toHaveProperty("copilotSessionRegistryV1");
      }
      if (stage === "marker_remove") {
        expect(harness.storageValues).not.toHaveProperty("copilotSessionRegistryV1");
      }

      harness.setRetiredStorageFailureStage(undefined);
      await expect(sendRuntimeMessage(harness, { type: "unpair" })).resolves.toEqual({ ok: true });
      expect(harness.storageValues).not.toHaveProperty("retiredCopilotCustodyBlockedV1");
      expect(harness.storageValues).not.toHaveProperty("copilotSessionRegistryV1");
      expect(harness.sessionStorageValues).not.toHaveProperty("copilotBrowserInstanceV1");
      expect(harness.storageValues.nativeBootstrapDisabled).toBe(true);
      expect(harness.relaySockets).toHaveLength(0);
    },
  );

  it("keeps a persisted custody marker inert across worker startup without a registry", async () => {
    const harness = await loadBackground({
      inheritedDebuggerTabIds: [18],
      nativeMessage: async (request) => nativeSuccess(request),
      storedConfig: {
        relayUrl: "ws://127.0.0.1:18797/extension",
        token: TEST_RELAY_KEY,
        authVersion: 2,
        accessMode: "all",
        retiredCopilotCustodyBlockedV1: true,
      },
    });

    await vi.waitFor(() =>
      expect(harness.debuggerDetach).toHaveBeenCalledWith({ targetId: "tab-18" }),
    );
    expect(harness.relaySockets).toHaveLength(0);
    expect(harness.sendNativeMessage).not.toHaveBeenCalled();
    expect(harness.debuggerAttach).not.toHaveBeenCalled();
    await expect(sendRuntimeMessage(harness, { type: "getStatus" })).resolves.toMatchObject({
      retiredCopilotCustodyBlocked: true,
      accessibleTabCount: 0,
    });
  });
});

describe("relay pairing and authentication", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(async () => {
    await cleanupBackgroundHarnesses();
    vi.unstubAllGlobals();
  });

  it("clears malformed persisted pairing before opening a relay", async () => {
    const harness = await loadBackground({
      storedConfig: { relayUrl: "ws://gateway.example/extension", token: TEST_RELAY_KEY },
    });

    expect(harness.relaySockets).toHaveLength(0);
    expect(harness.storageValues).not.toHaveProperty("relayUrl");
  });

  it("offers only the non-secret v2 relay subprotocol", async () => {
    const harness = await loadBackground();
    expect(harness.relaySockets[0]?.protocols).toEqual(["openclaw-extension-relay.v2"]);
    expect(JSON.stringify(harness.relaySockets[0]?.protocols)).not.toContain(TEST_RELAY_KEY);
  });

  it("cancels the opening deadline when the socket-close fallback ends the relay", async () => {
    const harness = await loadBackground({ relayNegotiatedProtocol: "unsupported" });
    const socket = harness.relaySockets[0];
    if (!socket) {
      throw new Error("expected relay socket");
    }
    harness.clearAlarm.mockClear();
    socket.close.mockImplementationOnce(() => {
      throw new Error("socket close failed");
    });

    socket.open();

    await vi.waitFor(() => expect(socket.close).toHaveBeenCalledTimes(2));
    expect(harness.clearAlarm).toHaveBeenCalledOnce();
  });

  it("revokes synchronously while an older manual pairing save is stalled", async () => {
    const harness = await loadBackground({
      initialTabs: [{ id: 131, url: "https://example.com/paired", groupId: 7 }],
    });
    const socket = harness.relaySockets[0];
    if (!socket) {
      throw new Error("expected relay socket");
    }
    await harness.authenticate(socket);
    harness.storageSet.mockClear();
    const replacementRelayUrl = "ws://127.0.0.1:18798/extension";
    const releaseSave = harness.deferStorageSetMatching({ relayUrl: replacementRelayUrl });
    const pairing = sendRuntimeMessage(harness, {
      type: "pair",
      pairingString: `${replacementRelayUrl}#${REPLACEMENT_TEST_RELAY_KEY}`,
      accessMode: "all",
    });
    await vi.waitFor(() =>
      expect(harness.storageSet).toHaveBeenCalledWith(
        expect.objectContaining({ relayUrl: replacementRelayUrl }),
      ),
    );

    const unpairing = sendRuntimeMessage(harness, { type: "unpair" });
    expect(socket.close).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(harness.storageValues.nativeBootstrapDisabled).toBe(true));
    releaseSave();

    await expect(pairing).resolves.toMatchObject({ ok: false });
    await expect(unpairing).resolves.toEqual({ ok: true });
    expect(harness.storageValues).not.toHaveProperty("relayUrl");
  });
});

describe("standalone relay wake-up", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
  });

  afterEach(async () => {
    await cleanupBackgroundHarnesses();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it.each([18798, 20123])(
    "wakes the paired port %i on reconnect, at most once per minute",
    async (relayPort) => {
      const harness = await loadBackground({
        storedConfig: { relayUrl: `ws://127.0.0.1:${relayPort}/extension`, token: TEST_RELAY_KEY },
        nativeMessage: async (request) => ({
          v: 1,
          ok: true,
          nonce: (request as { nonce: string }).nonce,
          relay: "spawned",
        }),
      });
      expect(harness.sendNativeMessage).not.toHaveBeenCalled();
      harness.relaySockets.at(-1)?.close();
      await vi.advanceTimersByTimeAsync(1000);
      expect(harness.sendNativeMessage).toHaveBeenCalledExactlyOnceWith(
        "ai.openclaw.browser_bootstrap",
        { v: 1, op: "ensure_relay", nonce: expect.any(String), relayPort },
      );
      harness.relaySockets.at(-1)?.close();
      await vi.advanceTimersByTimeAsync(2000);
      expect(harness.relaySockets).toHaveLength(3);
      expect(harness.sendNativeMessage).toHaveBeenCalledOnce();
      vi.setSystemTime(Date.now() + 60_000);
      harness.relaySockets.at(-1)?.close();
      await vi.advanceTimersByTimeAsync(4000);
      expect(harness.sendNativeMessage).toHaveBeenCalledTimes(2);
    },
  );

  it("retains native relay wake-up after manual loopback pairing", async () => {
    const relayPort = 20123;
    const harness = await loadBackground({
      nativeMessage: async (request) => ({
        v: 1,
        ok: true,
        nonce: (request as { nonce: string }).nonce,
        relay: "spawned",
      }),
    });

    await expect(
      sendRuntimeMessage(harness, {
        type: "pair",
        pairingString: `ws://127.0.0.1:${relayPort}/extension#${REPLACEMENT_TEST_RELAY_KEY}`,
      }),
    ).resolves.toEqual({ ok: true });
    expect(harness.storageValues).not.toHaveProperty("nativeBootstrapDisabled");
    expect(harness.sendNativeMessage).not.toHaveBeenCalled();

    harness.relaySockets.at(-1)?.close();
    await vi.advanceTimersByTimeAsync(1000);
    expect(harness.sendNativeMessage).toHaveBeenCalledExactlyOnceWith(
      "ai.openclaw.browser_bootstrap",
      { v: 1, op: "ensure_relay", nonce: expect.any(String), relayPort },
    );
  });

  it("keeps native bootstrap suppressed until manual loopback pairing commits", async () => {
    const relayPort = 20123;
    const harness = await loadBackground({
      storedConfig: { nativeBootstrapDisabled: true, nativeBootstrapState: "disabled" },
      nativeMessage: async (request) => ({
        v: 1,
        ok: true,
        nonce: (request as { nonce: string }).nonce,
        relay: "spawned",
      }),
    });
    const releaseManualGuard = harness.deferStorageSetMatching({
      nativeBootstrapDisabled: true,
      nativeBootstrapState: "disabled",
    });

    const pairing = sendRuntimeMessage(harness, {
      type: "pair",
      pairingString: `ws://127.0.0.1:${relayPort}/extension#${REPLACEMENT_TEST_RELAY_KEY}`,
    });
    await vi.waitFor(() =>
      expect(harness.storageSet).toHaveBeenCalledWith(
        expect.objectContaining({
          nativeBootstrapDisabled: true,
          nativeBootstrapState: "disabled",
        }),
      ),
    );

    harness.alarmListener({ name: "openclaw-relay-watchdog" });
    await vi.advanceTimersByTimeAsync(0);
    expect(harness.sendNativeMessage).not.toHaveBeenCalled();

    releaseManualGuard();
    await expect(pairing).resolves.toEqual({ ok: true });
    expect(harness.storageValues).toMatchObject({
      relayUrl: `ws://127.0.0.1:${relayPort}/extension`,
      pairingSource: "manual",
    });
    expect(harness.storageValues).not.toHaveProperty("nativeBootstrapDisabled");
    expect(harness.sendNativeMessage).not.toHaveBeenCalled();
  });

  it("does not let stale remote-pairing startup disable newer standalone wake-up", async () => {
    const relayPort = 20123;
    const harness = await loadBackground({
      storedConfig: {
        relayUrl: "wss://gateway.example.com/browser/extension",
        token: TEST_RELAY_KEY,
        authVersion: 2,
        accessMode: "selected",
        pairingSource: "manual",
        nativeBootstrapDisabled: true,
        nativeBootstrapState: "disabled",
      },
    });
    delete harness.storageValues.nativeBootstrapDisabled;
    delete harness.storageValues.nativeBootstrapState;
    const releaseStaleBootstrapStatus =
      harness.deferStorageGetContaining("nativeBootstrapDisabled");

    harness.alarmListener({ name: "openclaw-relay-watchdog" });
    await vi.waitFor(() =>
      expect(harness.storageGet.mock.calls).toContainEqual([
        expect.arrayContaining(["nativeBootstrapDisabled"]),
      ]),
    );

    await expect(
      sendRuntimeMessage(harness, {
        type: "pair",
        pairingString: `ws://127.0.0.1:${relayPort}/extension#${REPLACEMENT_TEST_RELAY_KEY}`,
      }),
    ).resolves.toEqual({ ok: true });
    releaseStaleBootstrapStatus();
    await vi.advanceTimersByTimeAsync(0);

    expect(harness.storageValues).toMatchObject({
      relayUrl: `ws://127.0.0.1:${relayPort}/extension`,
      pairingSource: "manual",
    });
    expect(harness.storageValues).not.toHaveProperty("nativeBootstrapDisabled");
  });

  it.each([
    ["local Gateway", "ws://127.0.0.1:18789/browser/extension", false],
    ["remote Gateway", "wss://gateway.example.com/browser/extension", false],
    ["secure loopback", "wss://localhost:18798/extension", false],
    ["automatic setup opt-out", "ws://127.0.0.1:18798/extension", true],
  ])("does not wake a daemon for %s", async (_label, relayUrl, nativeBootstrapDisabled) => {
    const harness = await loadBackground({
      storedConfig: { relayUrl, token: TEST_RELAY_KEY, nativeBootstrapDisabled },
    });
    harness.relaySockets.at(-1)?.close();
    await vi.advanceTimersByTimeAsync(1000);
    expect(harness.relaySockets).toHaveLength(2);
    expect(harness.sendNativeMessage).not.toHaveBeenCalled();
  });
});
