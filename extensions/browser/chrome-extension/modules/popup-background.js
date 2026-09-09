import {
  ACCESS_MODE_ALL,
  ACCESS_MODE_SELECTED,
  nearestGroupColor,
  parsePairingString,
} from "./relay-core.js";
import { isValidTabId, tabEligibility } from "./tab-eligibility.js";

function errorResponse(sendResponse, error) {
  sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
}

/** Own manual/native pairing transactions and compact popup/options messages. */
export function createPopupMessageHandler({
  chromeApi = chrome,
  pairingConfigStore,
  policy,
  accessReady,
  getConfig,
  getRelayState,
  getRelayStatusHint,
  getNativeBootstrapStatus,
  enableNativeBootstrap,
  onManualPairingStart,
  onManualPairingCommitted,
  onUnpairStart,
  isRetiredCopilotCustodyBlocked,
  requireAutomationAllowed,
  discardRetiredCopilotCustody,
  resetRelayState,
  suspendRelayConnections,
  resumeRelayConnections,
  reconcilePairingInvalidation,
  reconcileAccessMode,
  runAccessMutation,
  detachAllDebuggerSessions,
  clearRelayTabs,
  syncTabsToRelay,
  closeRelaySocket,
  connectRelay,
  setBadge,
  detachDebugger,
  isTabSelected,
  removeTabFromSelectedScope,
  addTabToSelectedScope,
  replaceSelectedScope,
  clearSelectedScope,
  scheduleTabsSync,
  pauseTab,
}) {
  let pairingGeneration = 0;
  let bootstrapControlGeneration = 0;
  let shareOnlyInFlight = false;

  const assertPairingCurrent = (generation) => {
    if (generation !== pairingGeneration) {
      throw new Error("Pairing was superseded by a newer request.");
    }
  };

  async function applyPairing({ pairing, pairingString, accessMode, source = "manual" }) {
    const parsed = pairing ?? parsePairingString(pairingString);
    if (!parsed) {
      return { ok: false, error: "Invalid pairing string." };
    }
    const generation = ++pairingGeneration;
    const manualPairingGuard =
      source === "manual"
        ? // Disable native bootstrap synchronously, before the first await. The
          // persisted write completes before the manual transaction continues.
          onManualPairingStart()
        : null;
    await manualPairingGuard;
    assertPairingCurrent(generation);
    await requireAutomationAllowed();
    assertPairingCurrent(generation);
    const initialConfig = await getConfig();
    assertPairingCurrent(generation);
    if (initialConfig.scopeCleanupPending) {
      return {
        ok: false,
        error: "Finish the one-tab handoff before changing the Sean pairing.",
      };
    }
    if (source === "native" && initialConfig.relayUrl) {
      return { ok: false, existing: true };
    }
    suspendRelayConnections();
    closeRelaySocket();
    await accessReady;
    assertPairingCurrent(generation);
    await runAccessMutation(async () => {
      assertPairingCurrent(generation);
      if (source === "native") {
        const currentConfig = await getConfig();
        assertPairingCurrent(generation);
        if (currentConfig.relayUrl) {
          return;
        }
      }
      suspendRelayConnections();
      closeRelaySocket();
      const normalizedMode =
        accessMode === ACCESS_MODE_SELECTED ? ACCESS_MODE_SELECTED : ACCESS_MODE_ALL;
      const downgrading =
        policy.mode === ACCESS_MODE_ALL && normalizedMode === ACCESS_MODE_SELECTED;
      if (downgrading) {
        policy.beginTransition();
      }
      try {
        await pairingConfigStore.save(parsed, nearestGroupColor(), normalizedMode, source);
        assertPairingCurrent(generation);
        await reconcileAccessMode(normalizedMode, { transitioning: downgrading });
        assertPairingCurrent(generation);
        policy.setEnabled(true);
      } catch (error) {
        if (downgrading) {
          policy.endTransition();
        }
        throw error;
      }
      resetRelayState();
      assertPairingCurrent(generation);
      resumeRelayConnections();
      await connectRelay(() => generation === pairingGeneration);
      if (generation !== pairingGeneration) {
        closeRelaySocket();
        setBadge("off");
        assertPairingCurrent(generation);
      }
    });
    if (source === "manual") {
      assertPairingCurrent(generation);
      await onManualPairingCommitted(parsed, () => generation === pairingGeneration);
      assertPairingCurrent(generation);
    }
    return { ok: true };
  }

  async function unpair() {
    pairingGeneration += 1;
    const disabledPersisted = onUnpairStart();
    policy.setEnabled(false);
    policy.invalidateAll();
    clearRelayTabs();
    suspendRelayConnections();
    resetRelayState();
    closeRelaySocket();
    setBadge("off");
    await accessReady;
    policy.setEnabled(false);
    policy.invalidateAll();
    closeRelaySocket();
    setBadge("off");
    await runAccessMutation(async () => {
      policy.setEnabled(false);
      const detaching = detachAllDebuggerSessions();
      await disabledPersisted;
      await pairingConfigStore.clear();
      await policy.clearDenied();
      await clearSelectedScope();
      await detaching;
      await discardRetiredCopilotCustody();
      resetRelayState();
      closeRelaySocket();
      setBadge("off");
    });
    return { ok: true };
  }

  async function setConnectionEnabled(enabled) {
    await accessReady;
    await requireAutomationAllowed();
    const config = await getConfig();
    if (!config.relayUrl) {
      return { ok: false, error: "Pair the extension first." };
    }
    const generation = ++pairingGeneration;

    if (!enabled) {
      // Revoke in memory immediately, then persist the disconnected state before
      // closing. If MV3 stops this worker mid-operation, startup stays fail-closed.
      policy.setEnabled(false);
      policy.invalidateAll();
      suspendRelayConnections();
      setBadge("off");
      await runAccessMutation(async () => {
        let firstError;
        try {
          await pairingConfigStore.setConnectionEnabled(false);
        } catch (error) {
          firstError = error;
        }
        // The relay treats this full tab list as authoritative. Publish the empty
        // inventory before closing so it cannot retain stale tab descriptors.
        clearRelayTabs();
        resetRelayState();
        closeRelaySocket();
        try {
          await detachAllDebuggerSessions();
        } catch (error) {
          firstError ??= error;
        } finally {
          closeRelaySocket();
          setBadge("off");
        }
        if (firstError) {
          throw firstError;
        }
      });
      return { ok: true, connectionEnabled: false };
    }

    suspendRelayConnections();
    policy.setEnabled(false);
    policy.invalidateAll();
    closeRelaySocket();
    await runAccessMutation(async () => {
      await pairingConfigStore.setConnectionEnabled(true);
      assertPairingCurrent(generation);
      policy.setEnabled(true);
      resetRelayState();
      resumeRelayConnections();
      await connectRelay(() => generation === pairingGeneration);
      assertPairingCurrent(generation);
    });
    return { ok: true, connectionEnabled: true };
  }

  async function shareOnlyTab(tabId) {
    if (!isValidTabId(tabId)) {
      return { ok: false, error: "Invalid tab access action." };
    }
    if (shareOnlyInFlight) {
      return { ok: false, error: "A tab handoff is already in progress." };
    }
    shareOnlyInFlight = true;
    let transitionOpen = false;
    const endTransition = () => {
      if (!transitionOpen) return;
      transitionOpen = false;
      policy.endTransition();
    };
    try {
      await accessReady;
      await requireAutomationAllowed();
      const config = await getConfig();
      if (!config.relayUrl) {
        return { ok: false, error: "Pair the extension first." };
      }
      if (!config.connectionEnabled && !config.scopeCleanupPending) {
        return { ok: false, error: "Reconnect Sean before sharing a tab." };
      }
      // Read eligibility independently from policy state so a failed handoff
      // can be retried while the access policy remains disabled.
      const preliminary = await chromeApi.tabs.get(tabId);
      let preliminaryFileAccessAllowed = false;
      try {
        preliminaryFileAccessAllowed =
          (await chromeApi.extension?.isAllowedFileSchemeAccess?.()) === true;
      } catch {
        preliminaryFileAccessAllowed = false;
      }
      if (
        !tabEligibility(preliminary, { fileAccessAllowed: preliminaryFileAccessAllowed }).eligible
      ) {
        return { ok: false, error: "This tab cannot be shared with Sean." };
      }

      const generation = ++pairingGeneration;
      policy.beginTransition();
      transitionOpen = true;
      return await runAccessMutation(async () => {
        let revocationStarted = false;
        try {
          const currentConfig = await getConfig();
          assertPairingCurrent(generation);
          if (
            !currentConfig.relayUrl ||
            (!currentConfig.connectionEnabled && !currentConfig.scopeCleanupPending)
          ) {
            throw new Error("Reconnect Sean before sharing a tab.");
          }
          const currentBefore = await chromeApi.tabs.get(tabId);
          let fileAccessAllowed = false;
          try {
            fileAccessAllowed = (await chromeApi.extension?.isAllowedFileSchemeAccess?.()) === true;
          } catch {
            fileAccessAllowed = false;
          }
          if (!tabEligibility(currentBefore, { fileAccessAllowed }).eligible) {
            throw new Error("This tab cannot be shared with Sean.");
          }

          // Hold the durable state disconnected for the whole ACL rewrite. If
          // the worker is stopped mid-operation, startup remains fail-closed.
          policy.setEnabled(false);
          policy.invalidateAll();
          suspendRelayConnections();
          revocationStarted = true;
          await pairingConfigStore.beginShareOnly();
          assertPairingCurrent(generation);
          clearRelayTabs();
          closeRelaySocket();
          setBadge("off");
          await policy.waitForPendingCreations();
          await detachAllDebuggerSessions();
          assertPairingCurrent(generation);

          if (policy.isDenied(tabId)) {
            await policy.allow(tabId);
          }
          policy.setMode(ACCESS_MODE_SELECTED);
          await replaceSelectedScope(tabId);
          policy.invalidateAll();
          assertPairingCurrent(generation);
          const current = await chromeApi.tabs.get(tabId);
          const remaining = [];
          for (const tab of await chromeApi.tabs.query({})) {
            if (isValidTabId(tab.id) && tab.id !== tabId && (await isTabSelected(tab))) {
              remaining.push(tab.id);
            }
          }
          if (
            !tabEligibility(current, { fileAccessAllowed }).eligible ||
            !(await isTabSelected(current)) ||
            remaining.length > 0
          ) {
            throw new Error("Could not restrict Sean to only this tab.");
          }
          await pairingConfigStore.completeShareOnly();
          assertPairingCurrent(generation);
          endTransition();
          policy.setEnabled(true);
          resetRelayState();
          resumeRelayConnections();
          await connectRelay(() => generation === pairingGeneration);
          assertPairingCurrent(generation);
          return { ok: true, accessMode: ACCESS_MODE_SELECTED, tabId };
        } catch (error) {
          endTransition();
          if (!revocationStarted) {
            throw error;
          }
          policy.setEnabled(false);
          policy.invalidateAll();
          clearRelayTabs();
          suspendRelayConnections();
          closeRelaySocket();
          setBadge("off");
          const pausePersisted = await pairingConfigStore
            .setConnectionEnabled(false)
            .then(() => true)
            .catch(() => false);
          const reason = error instanceof Error ? error.message : String(error);
          throw new Error(
            pausePersisted
              ? `${reason} Sean was disconnected; pairing was kept.`
              : `${reason} Sean is disconnected for now, but the pause could not be saved.`,
          );
        }
      });
    } finally {
      endTransition();
      shareOnlyInFlight = false;
    }
  }

  const handler = (msg, reply) => {
    let settled = false;
    const sendResponse = (response) => {
      if (!settled) {
        settled = true;
        reply(response);
      }
    };
    void (async () => {
      try {
        switch (msg?.type) {
          case "getStatus": {
            await accessReady;
            const retiredCopilotCustodyBlocked = isRetiredCopilotCustodyBlocked();
            const nativeBootstrap = await getNativeBootstrapStatus();
            const { relayUrl, accessMode, connectionEnabled, scopeCleanupPending } =
              await getConfig();
            await reconcilePairingInvalidation();
            const accessible = await policy.listAccessibleTabs();
            const hint = getRelayStatusHint();
            sendResponse({
              paired: Boolean(relayUrl),
              connectionEnabled,
              scopeCleanupPending,
              state: getRelayState(),
              accessMode,
              accessibleTabCount: accessible.length,
              relayUrl: relayUrl ?? "",
              nativeBootstrap,
              retiredCopilotCustodyBlocked,
              ...(hint ? { hint } : {}),
            });
            return;
          }
          case "pair":
            sendResponse(
              await applyPairing({
                pairingString: msg.pairingString,
                accessMode: msg.accessMode,
                source: "manual",
              }),
            );
            return;
          case "unpair":
            sendResponse(await unpair());
            return;
          case "setConnectionEnabled":
            if (typeof msg.enabled !== "boolean") {
              sendResponse({ ok: false, error: "Invalid connection setting." });
              return;
            }
            sendResponse(await setConnectionEnabled(msg.enabled));
            return;
          case "shareOnlyTab":
            sendResponse(await shareOnlyTab(msg.tabId));
            return;
          case "setNativeBootstrapEnabled":
            if (typeof msg.enabled !== "boolean") {
              sendResponse({ ok: false, error: "Invalid automatic setup setting." });
              return;
            }
            {
              const controlGeneration = ++bootstrapControlGeneration;
              const pairingAtReceipt = pairingGeneration;
              const isCurrent = () =>
                controlGeneration === bootstrapControlGeneration &&
                pairingAtReceipt === pairingGeneration;
              sendResponse({
                ok: true,
                result: await enableNativeBootstrap(msg.enabled, isCurrent),
              });
            }
            return;
          case "setAccessMode": {
            if (shareOnlyInFlight) {
              sendResponse({ ok: false, error: "A tab handoff is already in progress." });
              return;
            }
            if (msg.accessMode !== ACCESS_MODE_ALL && msg.accessMode !== ACCESS_MODE_SELECTED) {
              sendResponse({ ok: false, error: "Invalid access mode." });
              return;
            }
            const restricting = msg.accessMode === ACCESS_MODE_SELECTED;
            if (restricting) {
              policy.beginTransition();
            }
            let storedMode;
            try {
              if ((await getConfig()).scopeCleanupPending) {
                if (restricting) {
                  policy.endTransition();
                }
                sendResponse({
                  ok: false,
                  error: "Finish the one-tab handoff before changing access mode.",
                });
                return;
              }
              await requireAutomationAllowed();
              await accessReady;
              storedMode = await runAccessMutation(async () => {
                const mode = await pairingConfigStore.setAccessMode(msg.accessMode);
                await reconcileAccessMode(mode, { transitioning: restricting });
                return mode;
              });
            } catch (error) {
              if (restricting) {
                policy.endTransition();
              }
              throw error;
            }
            sendResponse({ ok: true, accessMode: storedMode });
            return;
          }
          case "toggleTabAccess": {
            if (shareOnlyInFlight) {
              sendResponse({ ok: false, error: "A tab handoff is already in progress." });
              return;
            }
            const tabId = msg.tabId;
            if (
              !isValidTabId(tabId) ||
              (msg.accessMode !== ACCESS_MODE_ALL && msg.accessMode !== ACCESS_MODE_SELECTED) ||
              typeof msg.grant !== "boolean"
            ) {
              sendResponse({ ok: false, error: "Invalid tab access action." });
              return;
            }
            await accessReady;
            await requireAutomationAllowed();
            if (policy.mode !== msg.accessMode) {
              sendResponse({ ok: false, error: "Browser access mode changed. Refresh and retry." });
              return;
            }
            const revocation = policy.beginRevocation(tabId);
            try {
              if ((await getConfig()).scopeCleanupPending) {
                sendResponse({
                  ok: false,
                  error: "Finish the one-tab handoff before changing tab access.",
                });
                return;
              }
              await runAccessMutation(async () => {
                if (policy.mode !== msg.accessMode) {
                  throw new Error("Browser access mode changed. Refresh and retry.");
                }
                if (policy.mode === ACCESS_MODE_ALL) {
                  if (msg.grant && policy.isDenied(tabId)) {
                    await policy.allow(tabId);
                  } else if (!msg.grant && !policy.isDenied(tabId)) {
                    await pauseTab(tabId);
                  }
                } else {
                  const selected = await isTabSelected(await chromeApi.tabs.get(tabId));
                  if (!msg.grant && selected) {
                    policy.invalidateTab(tabId);
                    await detachDebugger(tabId);
                    await removeTabFromSelectedScope(tabId);
                  } else if (msg.grant && !selected) {
                    policy.invalidateTab(tabId);
                    await addTabToSelectedScope(tabId);
                  }
                }
                scheduleTabsSync();
                await syncTabsToRelay();
              });
            } finally {
              policy.endRevocation(revocation);
            }
            const state = await policy.inspectTab(tabId);
            sendResponse({ ok: true, accessible: state.accessible, denied: state.denied });
            return;
          }
          case "getTabAccess": {
            await accessReady;
            const state = await policy.inspectTab(msg.tabId);
            sendResponse({
              accessMode: policy.mode,
              accessible: state.accessible,
              eligible: state.eligible,
              denied: state.denied,
            });
            return;
          }
          default:
            sendResponse({ ok: false, error: "unknown message" });
        }
      } catch (error) {
        errorResponse(sendResponse, error);
      }
    })();
    return true;
  };

  handler.applyPairing = applyPairing;
  handler.unpair = unpair;
  return handler;
}
