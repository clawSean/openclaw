import { effectiveTabUrl } from "./tab-eligibility.js";

export function initialBlankDocument(tab) {
  return tab.url === "about:blank" || (!tab.url && tab.pendingUrl === "about:blank");
}

export function observeCreatedTabMove({
  tabId,
  pendingCreations,
  createdTabs,
  invalidateTab,
  retireTab,
}) {
  for (const pending of pendingCreations) {
    pending.movedTabs.add(tabId);
  }
  const created = createdTabs.get(tabId);
  if (!created) {
    return false;
  }
  if (!created.handedOff) {
    invalidateTab(tabId);
    return false;
  }
  // A handed-off initial blank retains creator provenance until its first
  // real document. Moving it changes the physical identity, so retire that
  // provenance and tell the event owner to revoke its selected scope.
  retireTab(tabId);
  return true;
}

/** Re-read physical identity at the final creator-to-client handoff fence. */
export async function assertCreatedTabIdentity({ chromeApi, created, invalidateTab }) {
  created.assertCurrent();
  const current = await chromeApi.tabs.get(created.tab.id);
  created.assertCurrent();
  if (
    current.id !== created.tab.id ||
    current.windowId !== created.tab.windowId ||
    current.incognito !== created.tab.incognito
  ) {
    invalidateTab(created.tab.id);
    throw new Error(`tab ${created.tab.id} changed during creation`);
  }
  return current;
}

/** Retire native and selection authority before considering creator-owned tab removal. */
export async function cleanupFailedTabCreation({
  chromeApi,
  created,
  error,
  attached,
  selectionGrant,
  ownsRollback,
}) {
  const cleanupFailures = (
    await Promise.allSettled([
      Promise.resolve().then(() => attached?.detach()),
      Promise.resolve().then(() => selectionGrant?.rollback()),
    ])
  )
    .filter((result) => result.status === "rejected")
    .map((result) => result.reason);
  try {
    if (ownsRollback()) {
      const current = await chromeApi.tabs.get(created.tab.id);
      if (
        ownsRollback() &&
        current.id === created.tab.id &&
        current.windowId === created.tab.windowId &&
        ((created.initialBlank &&
          initialBlankDocument(current) &&
          (!current.pendingUrl || current.pendingUrl === "about:blank")) ||
          (effectiveTabUrl(current) === effectiveTabUrl(created.tab) &&
            (!current.url || current.url === effectiveTabUrl(created.tab)))) &&
        current.groupId === created.groupId &&
        current.incognito === created.tab.incognito
      ) {
        await chromeApi.tabs.remove(created.tab.id);
      }
    }
  } catch (cleanupError) {
    cleanupFailures.push(cleanupError);
  }
  if (cleanupFailures.length > 0) {
    console.warn(`Cleanup failed for created tab ${created.tab.id}; close it manually.`);
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}; cleanup failed for created tab ${created.tab.id}; close it manually.`,
      { cause: new AggregateError([error, ...cleanupFailures]) },
    );
  }
  throw error;
}
