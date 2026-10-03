import {
  addTabToOpenClawGroup,
  isTabSelected as isTabInOpenClawGroup,
} from "./relay-tab-groups.js";

const EXPLICIT_SELECTED_TAB_IDS_KEY = "explicitSelectedTabIdsV1";
const EXPLICIT_SELECTED_TAB_BACKEND_KEY = "explicitSelectedTabBackendV1";
const EXPLICIT_SELECTED_TAB_MUTATION_KEY = "explicitSelectedTabMutationV1";
const MAX_EXPLICIT_SELECTED_TABS = 256;
const REPLACEMENT_TAB_ATTEMPTS = 8;
const REPLACEMENT_TAB_RETRY_MS = 50;
const STORAGE_OPERATION_TIMEOUT_MS = 1_000;

const STORAGE_ERROR =
  "Selected-tab storage is unavailable. OpenClaw stopped sharing all tabs; retry when storage is available.";
const BACKEND_SWITCH_ABORTED_ERROR =
  "Compatibility sharing was not enabled because browser storage could not save the change. Your previous tab-group sharing scope is unchanged and may remain shared; retry when storage is available.";
const STORAGE_TRANSACTION_ABORTED_ERROR =
  "Selected-tab update aborted because browser storage could not record or revoke it. OpenClaw stopped sharing tabs in this worker, but the prior committed tab scope may return if the extension worker restarts. Disconnect the pairing or retry when storage is available.";

async function boundedStorageOperation(operation) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Selected-tab storage operation timed out")),
          STORAGE_OPERATION_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function normalizeTabIds(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.filter((id) => Number.isInteger(id) && id >= 0))].slice(
    0,
    MAX_EXPLICIT_SELECTED_TABS,
  );
}

/**
 * Keep Chrome's tab-group access model until the user explicitly chooses the
 * popup's compatibility sharing path. Arc and Dia do not reliably implement
 * chrome.tabGroups, so that path switches to a session-scoped tab-id ledger.
 * The persistent backend marker prevents a browser restart from widening back
 * to stale tab groups after Chromium clears the session-scoped ids.
 */
export function createSelectedTabsController({
  chromeApi = chrome,
  getGroupColor,
  onAuthorityUnavailable,
}) {
  let explicitSelection = false;
  let backendMarkerPersisted = false;
  let selectedTabIds = new Set();
  const creationGrants = new Map();
  let sessionStorageAvailable = true;
  let readyPromise;
  let mutationQueue = Promise.resolve();

  function ensureReady() {
    if (!readyPromise) {
      readyPromise = (async () => {
        const [backendResult, idsResult] = await Promise.allSettled([
          chromeApi.storage.local.get([
            EXPLICIT_SELECTED_TAB_BACKEND_KEY,
            EXPLICIT_SELECTED_TAB_MUTATION_KEY,
          ]),
          chromeApi.storage.session.get([EXPLICIT_SELECTED_TAB_IDS_KEY]),
        ]);
        if (backendResult.status === "rejected") {
          // Unknown backend state must never widen into tab-group authority.
          explicitSelection = true;
          selectedTabIds.clear();
          sessionStorageAvailable = false;
          return;
        }
        backendMarkerPersisted = backendResult.value?.[EXPLICIT_SELECTED_TAB_BACKEND_KEY] === true;
        explicitSelection = backendMarkerPersisted;
        if (backendResult.value?.[EXPLICIT_SELECTED_TAB_MUTATION_KEY] === true) {
          // A prior ledger write did not commit completely. Ignore its session
          // value until a fresh explicit share replaces it successfully.
          explicitSelection = true;
          selectedTabIds.clear();
          sessionStorageAvailable = false;
          return;
        }
        if (idsResult.status === "rejected") {
          if (explicitSelection) {
            selectedTabIds.clear();
            sessionStorageAvailable = false;
          }
          return;
        }
        selectedTabIds = new Set(normalizeTabIds(idsResult.value?.[EXPLICIT_SELECTED_TAB_IDS_KEY]));
      })();
    }
    return readyPromise;
  }

  function mutate(operation) {
    const run = mutationQueue.then(async () => {
      await ensureReady();
      return await operation();
    });
    mutationQueue = run.catch(() => undefined);
    return run;
  }

  async function waitForMutations() {
    await ensureReady();
    await mutationQueue;
  }

  function poisonAuthority() {
    sessionStorageAvailable = false;
    selectedTabIds.clear();
    creationGrants.clear();
    onAuthorityUnavailable?.();
  }

  async function revokeStoredGrants() {
    try {
      await boundedStorageOperation(() =>
        chromeApi.storage.session.remove([EXPLICIT_SELECTED_TAB_IDS_KEY]),
      );
    } catch (removeError) {
      try {
        await boundedStorageOperation(() =>
          chromeApi.storage.session.set({ [EXPLICIT_SELECTED_TAB_IDS_KEY]: [] }),
        );
      } catch (setError) {
        throw new AggregateError(
          [removeError, setError],
          "Could not revoke the prior selected-tab ledger.",
          { cause: setError },
        );
      }
    }
  }

  async function persist(nextIds, { allowRecovery = false } = {}) {
    if (!sessionStorageAvailable && !allowRecovery) {
      throw new Error(STORAGE_ERROR);
    }
    let guardPersisted = false;
    let ledgerRevoked = false;
    let ledgerWriteStarted = false;
    try {
      // Start both restart-safe denial paths before waiting on either browser
      // storage backend. If the durable guard stalls or rejects, clearing the
      // session ledger still prevents a replacement worker from reviving it.
      const [guard, revoked] = await Promise.allSettled([
        boundedStorageOperation(() =>
          chromeApi.storage.local.set({ [EXPLICIT_SELECTED_TAB_MUTATION_KEY]: true }),
        ),
        revokeStoredGrants(),
      ]);
      guardPersisted = guard.status === "fulfilled";
      ledgerRevoked = revoked.status === "fulfilled";
      if (guard.status === "rejected" || revoked.status === "rejected") {
        throw new AggregateError(
          [guard, revoked]
            .filter((result) => result.status === "rejected")
            .map((result) => result.reason),
          "Could not start the selected-tab ledger mutation.",
        );
      }
      ledgerWriteStarted = true;
      await chromeApi.storage.session.set({ [EXPLICIT_SELECTED_TAB_IDS_KEY]: [...nextIds] });
      await chromeApi.storage.local.remove([EXPLICIT_SELECTED_TAB_MUTATION_KEY]);
    } catch (error) {
      let cleanupRevoked = false;
      try {
        // The persistent mutation marker normally owns restart-safe denial;
        // independently revoke the session ledger when that marker failed.
        await revokeStoredGrants();
        cleanupRevoked = true;
      } catch {
        // Keep this worker poisoned even when neither durable denial can be
        // confirmed. A replacement worker may then recover the last committed
        // session ledger, which the surfaced error states explicitly.
      }
      poisonAuthority();
      const restartDenialPersisted =
        guardPersisted || cleanupRevoked || (!ledgerWriteStarted && ledgerRevoked);
      throw new Error(restartDenialPersisted ? STORAGE_ERROR : STORAGE_TRANSACTION_ABORTED_ERROR, {
        cause: error,
      });
    }
    sessionStorageAvailable = true;
    selectedTabIds = nextIds;
  }

  async function enableExplicitSelection() {
    if (backendMarkerPersisted) {
      return;
    }
    const switchingFromGroups = !explicitSelection;
    try {
      await boundedStorageOperation(() =>
        chromeApi.storage.local.set({ [EXPLICIT_SELECTED_TAB_BACKEND_KEY]: true }),
      );
    } catch (error) {
      throw new Error(switchingFromGroups ? BACKEND_SWITCH_ABORTED_ERROR : STORAGE_ERROR, {
        cause: error,
      });
    }
    backendMarkerPersisted = true;
    explicitSelection = true;
  }

  async function validateTab(tabId, created) {
    if (!Number.isInteger(tabId) || tabId < 0) {
      throw new Error("No valid tab to share.");
    }
    const tab = await chromeApi.tabs.get(tabId);
    created?.assertCurrent();
    if (
      created &&
      (tab.id !== created.tab.id ||
        tab.windowId !== created.tab.windowId ||
        tab.incognito !== created.tab.incognito)
    ) {
      throw new Error(`tab ${tabId} changed during creation`);
    }
    return tab;
  }

  async function validateReplacementTab(tabId) {
    let lastError;
    for (let attempt = 0; attempt < REPLACEMENT_TAB_ATTEMPTS; attempt += 1) {
      try {
        return await validateTab(tabId);
      } catch (error) {
        lastError = error;
        if (attempt + 1 < REPLACEMENT_TAB_ATTEMPTS) {
          await new Promise((resolve) => {
            setTimeout(resolve, REPLACEMENT_TAB_RETRY_MS);
          });
        }
      }
    }
    throw lastError;
  }

  async function isExplicit() {
    await waitForMutations();
    return explicitSelection;
  }

  function isExplicitSync() {
    return explicitSelection;
  }

  async function isRecoveryRequired() {
    await waitForMutations();
    return explicitSelection && !sessionStorageAvailable;
  }

  async function has(tabId) {
    await waitForMutations();
    return explicitSelection && sessionStorageAvailable && selectedTabIds.has(tabId);
  }

  async function isSelected(tab) {
    await waitForMutations();
    if (explicitSelection) {
      return sessionStorageAvailable && selectedTabIds.has(tab?.id);
    }
    const selectedByGroup = await isTabInOpenClawGroup(tab);
    // A compatibility transition can overtake the browser API lookup. Re-read
    // the authoritative backend before returning so stale group membership can
    // never widen the newly activated session ledger.
    await waitForMutations();
    return explicitSelection
      ? sessionStorageAvailable && selectedTabIds.has(tab?.id)
      : selectedByGroup;
  }

  async function add(tabId, created) {
    await ensureReady();
    if (!explicitSelection) {
      await validateTab(tabId, created);
      await addTabToOpenClawGroup(tabId, { chromeApi, getGroupColor, created });
      return undefined;
    }
    return await mutate(async () => {
      await validateTab(tabId, created);
      if (selectedTabIds.size >= MAX_EXPLICIT_SELECTED_TABS && !selectedTabIds.has(tabId)) {
        throw new Error(`No more than ${MAX_EXPLICIT_SELECTED_TABS} tabs can be shared.`);
      }
      const previous = new Set(selectedTabIds);
      const next = new Set(previous);
      next.add(tabId);
      await persist(next);
      try {
        // A tab can move to another window or become incognito while the
        // session ledger write is pending without emitting an access event.
        // Re-read the exact identity before the creator can hand it off.
        if (created) {
          await validateTab(tabId, created);
        }
      } catch (error) {
        try {
          await persist(previous);
        } catch {
          // persist() already cleared in-memory authority and poisoned writes.
        }
        throw error;
      }
      if (!created) {
        creationGrants.delete(tabId);
        return undefined;
      }
      const grant = Symbol("selected-tab-creation");
      creationGrants.set(tabId, grant);
      return {
        commit: () => {
          if (creationGrants.get(tabId) === grant) {
            creationGrants.delete(tabId);
          }
        },
        rollback: async () => {
          await mutate(async () => {
            if (creationGrants.get(tabId) !== grant) {
              return;
            }
            if (selectedTabIds.has(tabId)) {
              const rolledBack = new Set(selectedTabIds);
              rolledBack.delete(tabId);
              await persist(rolledBack);
            }
            creationGrants.delete(tabId);
          });
        },
      };
    });
  }

  async function remove(tabId) {
    if (!Number.isInteger(tabId) || tabId < 0) {
      return;
    }
    await ensureReady();
    if (!explicitSelection) {
      try {
        await chromeApi.tabs.ungroup([tabId]);
      } catch {
        // The tab may already be gone.
      }
      return;
    }
    await mutate(async () => {
      const next = new Set(selectedTabIds);
      next.delete(tabId);
      await persist(next);
      creationGrants.delete(tabId);
    });
  }

  async function replaceTab(addedTabId, removedTabId) {
    if (
      !Number.isInteger(addedTabId) ||
      addedTabId < 0 ||
      !Number.isInteger(removedTabId) ||
      removedTabId < 0
    ) {
      return false;
    }
    await ensureReady();
    if (!explicitSelection) {
      return false;
    }
    return await mutate(async () => {
      const wasSelected = selectedTabIds.has(removedTabId);
      const creationGrant = creationGrants.get(removedTabId);
      const withoutRemoved = new Set(selectedTabIds);
      withoutRemoved.delete(removedTabId);
      if (wasSelected) {
        // Revoke the retired identity before waiting for Chromium to publish its
        // replacement. Readers stay behind this serialized, fail-closed mutation.
        await persist(withoutRemoved);
        creationGrants.delete(removedTabId);
        if (!creationGrant) {
          await validateReplacementTab(addedTabId);
          const withReplacement = new Set(withoutRemoved);
          withReplacement.add(addedTabId);
          await persist(withReplacement);
        }
      } else if (withoutRemoved.size !== selectedTabIds.size) {
        await persist(withoutRemoved);
      }
      return wasSelected;
    });
  }

  async function replaceWith(tabId) {
    return await mutate(async () => {
      await validateTab(tabId);
      await enableExplicitSelection();
      // One storage write is the consent boundary: readers wait behind this
      // mutation and never observe an intermediate empty or widened scope.
      await persist(new Set([tabId]), { allowRecovery: true });
      creationGrants.clear();
    });
  }

  async function reset() {
    return await mutate(async () => {
      // Stay fail-closed until both stores confirm that the explicit backend and
      // every session-scoped grant are gone.
      explicitSelection = true;
      sessionStorageAvailable = false;
      selectedTabIds.clear();
      creationGrants.clear();
      await chromeApi.storage.session.remove([EXPLICIT_SELECTED_TAB_IDS_KEY]);
      await chromeApi.storage.local.remove([
        EXPLICIT_SELECTED_TAB_BACKEND_KEY,
        EXPLICIT_SELECTED_TAB_MUTATION_KEY,
      ]);
      backendMarkerPersisted = false;
      explicitSelection = false;
      sessionStorageAvailable = true;
    });
  }

  return {
    add,
    has,
    isExplicit,
    isExplicitSync,
    isRecoveryRequired,
    isSelected,
    remove,
    replaceTab,
    replaceWith,
    reset,
  };
}
