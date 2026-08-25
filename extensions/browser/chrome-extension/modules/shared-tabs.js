// Arc does not reliably resolve Chrome's tabGroups promises. This module keeps
// the consent boundary independent of that API: a tab is accessible only after
// the user explicitly shares it from the popup.

export const SHARED_TAB_IDS_KEY = "openclawArcSharedTabIds";
export const MAX_SHARED_TABS = 256;
const STORAGE_ERROR = "Arc session storage is unavailable; no tabs can be shared.";

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
 * Create a storage-backed shared-tab registry.
 *
 * chrome.storage.session survives MV3 worker restarts but clears when the
 * browser exits, so a browser restart revokes every shared tab by default.
 * If session storage is unavailable, the registry fails closed and refuses to
 * share tabs.
 */
export function createSharedTabsRegistry(chromeApi) {
  const sharedTabIds = new Set();
  let storageAvailable = true;
  let readyPromise;
  let mutationQueue = Promise.resolve();

  function ensureReady() {
    if (!readyPromise) {
      readyPromise = (async () => {
        try {
          const stored = await chromeApi.storage.session.get(SHARED_TAB_IDS_KEY);
          for (const tabId of normalizeTabIds(stored?.[SHARED_TAB_IDS_KEY])) {
            sharedTabIds.add(tabId);
          }
        } catch {
          storageAvailable = false;
          sharedTabIds.clear();
        }
      })();
    }
    return readyPromise;
  }

  async function persist() {
    if (!storageAvailable) {
      return false;
    }
    try {
      await chromeApi.storage.session.set({
        [SHARED_TAB_IDS_KEY]: [...sharedTabIds],
      });
      return true;
    } catch {
      storageAvailable = false;
      sharedTabIds.clear();
      return false;
    }
  }

  function mutate(operation) {
    const run = mutationQueue.then(async () => {
      await ensureReady();
      if (!storageAvailable) {
        throw new Error(STORAGE_ERROR);
      }
      const result = await operation();
      if (!(await persist())) {
        throw new Error(STORAGE_ERROR);
      }
      return result;
    });
    mutationQueue = run.catch(() => {});
    return run;
  }

  async function waitForMutations() {
    await ensureReady();
    await mutationQueue;
  }

  async function list() {
    await waitForMutations();
    if (!storageAvailable) {
      return [];
    }
    const tabs = [];
    const staleIds = [];
    for (const tabId of sharedTabIds) {
      try {
        const tab = await chromeApi.tabs.get(tabId);
        if (typeof tab?.id === "number") {
          tabs.push(tab);
        } else {
          staleIds.push(tabId);
        }
      } catch {
        staleIds.push(tabId);
      }
    }
    if (staleIds.length > 0) {
      await mutate(() => {
        for (const tabId of staleIds) {
          sharedTabIds.delete(tabId);
        }
      });
    }
    return tabs;
  }

  async function add(tabId) {
    if (!Number.isInteger(tabId) || tabId < 0) {
      throw new Error("No valid tab to share.");
    }
    await ensureReady();
    if (!storageAvailable) {
      throw new Error(STORAGE_ERROR);
    }
    // Validate that the tab still exists before recording consent.
    await chromeApi.tabs.get(tabId);
    await mutate(() => {
      if (sharedTabIds.size >= MAX_SHARED_TABS && !sharedTabIds.has(tabId)) {
        throw new Error(`No more than ${MAX_SHARED_TABS} tabs can be shared.`);
      }
      sharedTabIds.add(tabId);
    });
  }

  async function remove(tabId) {
    if (!Number.isInteger(tabId) || tabId < 0) {
      return;
    }
    await mutate(() => {
      sharedTabIds.delete(tabId);
    });
  }

  async function clear() {
    await mutate(() => {
      sharedTabIds.clear();
    });
  }

  async function has(tabId) {
    await waitForMutations();
    if (!storageAvailable) {
      return false;
    }
    if (!sharedTabIds.has(tabId)) {
      return false;
    }
    try {
      await chromeApi.tabs.get(tabId);
      return true;
    } catch {
      await remove(tabId);
      return false;
    }
  }

  function hasCached(tabId) {
    return storageAvailable && sharedTabIds.has(tabId);
  }

  return { add, clear, has, hasCached, list, remove };
}
