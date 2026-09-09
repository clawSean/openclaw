import {
  addTabToOpenClawGroup,
  isTabSelected as isTabInOpenClawGroup,
} from "./relay-tab-groups.js";

export const SHARED_TAB_IDS_KEY = "seanSharedTabIdsV1";
export const EXPLICIT_SELECTION_KEY = "seanExplicitSelectionV1";
export const MAX_SHARED_TABS = 256;
const REPLACEMENT_TAB_ATTEMPTS = 8;
const REPLACEMENT_TAB_RETRY_MS = 50;

const STORAGE_ERROR = "Sean tab selection is unavailable; no tabs were shared.";

function normalizeTabIds(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.filter((id) => Number.isInteger(id) && id >= 0))].slice(
    0,
    MAX_SHARED_TABS,
  );
}

/**
 * Arc does not reliably settle chrome.tabGroups promises. Keep the upstream
 * tab-group behavior until the personal explicit-selection path is used, then
 * make a session-scoped tab-id ledger authoritative. The persistent backend
 * marker prevents a browser restart from falling back to old tab groups after
 * session-scoped tab ids have been intentionally cleared by Chromium.
 */
export function createSharedTabsController({ chromeApi = chrome, getGroupColor }) {
  let explicitSelection = false;
  let sharedTabIds = new Set();
  let sessionStorageAvailable = true;
  let readyPromise;
  let mutationQueue = Promise.resolve();

  function ensureReady() {
    if (!readyPromise) {
      readyPromise = (async () => {
        const [backendResult, idsResult] = await Promise.allSettled([
          chromeApi.storage.local.get([EXPLICIT_SELECTION_KEY]),
          chromeApi.storage.session.get([SHARED_TAB_IDS_KEY]),
        ]);
        if (backendResult.status === "rejected") {
          // Unknown backend state must never widen into tab-group authority.
          explicitSelection = true;
          sharedTabIds.clear();
          sessionStorageAvailable = false;
          return;
        }
        explicitSelection = backendResult.value?.[EXPLICIT_SELECTION_KEY] === true;
        if (idsResult.status === "rejected") {
          if (explicitSelection) {
            sharedTabIds.clear();
            sessionStorageAvailable = false;
          }
          return;
        }
        sharedTabIds = new Set(normalizeTabIds(idsResult.value?.[SHARED_TAB_IDS_KEY]));
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

  async function persist(nextIds, { allowRecovery = false } = {}) {
    if (!sessionStorageAvailable && !allowRecovery) {
      throw new Error(STORAGE_ERROR);
    }
    try {
      await chromeApi.storage.session.set({ [SHARED_TAB_IDS_KEY]: [...nextIds] });
    } catch (error) {
      sessionStorageAvailable = false;
      sharedTabIds.clear();
      throw new Error(STORAGE_ERROR, { cause: error });
    }
    sessionStorageAvailable = true;
    sharedTabIds = nextIds;
  }

  async function enableExplicitSelection() {
    if (explicitSelection) {
      return;
    }
    try {
      await chromeApi.storage.local.set({ [EXPLICIT_SELECTION_KEY]: true });
    } catch (error) {
      throw new Error(STORAGE_ERROR, { cause: error });
    }
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
          await new Promise((resolve) => setTimeout(resolve, REPLACEMENT_TAB_RETRY_MS));
        }
      }
    }
    throw lastError;
  }

  async function isExplicit() {
    await waitForMutations();
    return explicitSelection;
  }

  async function has(tabId) {
    await waitForMutations();
    return explicitSelection && sessionStorageAvailable && sharedTabIds.has(tabId);
  }

  async function isSelected(tab) {
    if (await isExplicit()) {
      return await has(tab?.id);
    }
    return await isTabInOpenClawGroup(tab);
  }

  async function add(tabId, created) {
    await ensureReady();
    if (!explicitSelection) {
      await validateTab(tabId, created);
      await addTabToOpenClawGroup(tabId, { chromeApi, getGroupColor, created });
      return;
    }
    return await mutate(async () => {
      await validateTab(tabId, created);
      if (sharedTabIds.size >= MAX_SHARED_TABS && !sharedTabIds.has(tabId)) {
        throw new Error(`No more than ${MAX_SHARED_TABS} tabs can be shared.`);
      }
      const previous = new Set(sharedTabIds);
      const next = new Set(previous);
      next.add(tabId);
      await persist(next);
      try {
        created?.assertCurrent();
      } catch (error) {
        try {
          await persist(previous);
        } catch {
          // persist() already cleared in-memory authority and poisoned writes.
        }
        throw error;
      }
    });
  }

  async function addExplicit(tabId) {
    return await mutate(async () => {
      await validateTab(tabId);
      await enableExplicitSelection();
      if (sharedTabIds.size >= MAX_SHARED_TABS && !sharedTabIds.has(tabId)) {
        throw new Error(`No more than ${MAX_SHARED_TABS} tabs can be shared.`);
      }
      const next = new Set(sharedTabIds);
      next.add(tabId);
      await persist(next);
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
    return await mutate(async () => {
      const next = new Set(sharedTabIds);
      next.delete(tabId);
      await persist(next);
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
      const wasSelected = sharedTabIds.has(removedTabId);
      const withoutRemoved = new Set(sharedTabIds);
      withoutRemoved.delete(removedTabId);
      if (wasSelected) {
        // Revoke the retired identity durably before waiting for Arc/Chromium to
        // publish its replacement. Readers stay behind this serialized mutation,
        // so access remains fail-closed during the bounded lookup gap.
        await persist(withoutRemoved);
        try {
          await validateReplacementTab(addedTabId);
          const withReplacement = new Set(withoutRemoved);
          withReplacement.add(addedTabId);
          await persist(withReplacement);
        } catch (error) {
          throw error;
        }
      } else if (withoutRemoved.size !== sharedTabIds.size) {
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
    });
  }

  async function clear() {
    return await mutate(async () => {
      if (!explicitSelection) {
        return;
      }
      await persist(new Set());
    });
  }

  return { add, addExplicit, clear, has, isExplicit, isSelected, remove, replaceTab, replaceWith };
}
