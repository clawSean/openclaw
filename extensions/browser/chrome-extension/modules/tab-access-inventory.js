import { ACCESS_MODE_ALL, ACCESS_MODE_SELECTED } from "./relay-core.js";

/** Owns stable inventory snapshots and concurrent selected-tab membership reads. */
export function createTabAccessInventory({
  chromeApi,
  initialize,
  readState,
  resolveTabSnapshot,
  tabIsRevoking,
  eligibilityForTab,
  isDenied,
  isSelectedTab,
}) {
  return async function listAccessibleTabs({ allowDuringTransition = false } = {}) {
    await initialize(readState().mode);
    for (;;) {
      const state = readState();
      const listRevision = state.discoveryRevision;
      if (!state.enabled || (state.transitioning && !allowDuringTransition)) {
        return [];
      }
      const tabs = await chromeApi.tabs.query({});
      if (listRevision !== readState().discoveryRevision) {
        continue;
      }
      const accessible = [];
      const selectedCandidates = [];
      for (const snapshot of tabs) {
        if (listRevision !== readState().discoveryRevision) {
          break;
        }
        const tab = resolveTabSnapshot(snapshot.id, snapshot);
        if (tabIsRevoking(tab.id) || !eligibilityForTab(tab).eligible) {
          continue;
        }
        if (state.mode === ACCESS_MODE_ALL) {
          if (!isDenied(tab.id)) {
            accessible.push(tab);
          }
        } else {
          selectedCandidates.push(tab);
        }
      }
      if (state.mode === ACCESS_MODE_SELECTED && listRevision === readState().discoveryRevision) {
        const selected = await Promise.all(
          selectedCandidates.map(async (tab) => ({ tab, selected: await isSelectedTab(tab) })),
        );
        for (const result of selected) {
          if (result.selected) {
            accessible.push(result.tab);
          }
        }
      }
      if (listRevision === readState().discoveryRevision) {
        return accessible;
      }
    }
  };
}
