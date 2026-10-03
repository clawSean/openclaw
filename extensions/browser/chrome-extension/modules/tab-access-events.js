import { ACCESS_MODE_ALL, ACCESS_MODE_SELECTED } from "./relay-core.js";

/** Register Chrome lifecycle events that can grant, revoke, or project tab access. */
export function registerTabAccessEvents({
  chromeApi = chrome,
  accessReady,
  policy,
  attachments,
  nativeDetached,
  send,
  scheduleTabsSync,
  detachDebugger,
  pauseTab,
  removeTabFromOpenClawGroup,
  replaceTabInSelectedScope = async () => false,
  selectedTabsUseGroups = () => true,
  runAccessMutation,
}) {
  let groupEventRevision = 0;

  chromeApi.debugger.onEvent.addListener((source, method, params) => {
    if (typeof source.tabId !== "number") {
      return;
    }
    const accessEpoch = attachments.get(source.tabId)?.epoch;
    if (!accessEpoch || !policy.epochIsCurrent(source.tabId, accessEpoch)) {
      return;
    }
    policy.forwardDocumentEvent(
      {
        type: "cdpEvent",
        tabId: source.tabId,
        ...(source.sessionId ? { sessionId: source.sessionId } : {}),
        method,
        params,
      },
      send,
    );
  });

  chromeApi.debugger.onDetach.addListener((source, reason) => {
    if (typeof source.tabId !== "number") {
      return;
    }
    // Preserve controlled-document pause evidence before native retirement revokes it.
    const revocation =
      reason === "canceled_by_user" ? policy.beginRevocation(source.tabId) : undefined;
    nativeDetached(source.tabId);
    send({ type: "detached", tabId: source.tabId, reason });
    if (revocation === undefined) {
      return;
    }
    void runAccessMutation(async () => {
      try {
        await accessReady;
        if (policy.mode === ACCESS_MODE_ALL) {
          await pauseTab(source.tabId);
        } else {
          policy.invalidateTab(source.tabId);
          await removeTabFromOpenClawGroup(source.tabId);
          scheduleTabsSync();
        }
      } finally {
        policy.endRevocation(revocation);
      }
    }).catch(() => undefined);
  });

  chromeApi.tabs.onRemoved.addListener((tabId) => {
    policy.retireTab(tabId);
    void detachDebugger(tabId).catch((error) =>
      console.warn("Debugger removal cleanup failed", error),
    );
    void (async () => {
      await accessReady;
      scheduleTabsSync();
      await policy.forgetTab(tabId).catch(() => undefined);
      await removeTabFromOpenClawGroup(tabId).catch(() => undefined);
    })();
  });

  chromeApi.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
    const revocation = policy.beginRevocation(addedTabId);
    policy.retireTab(addedTabId);
    policy.retireTab(removedTabId);
    const detaching = [detachDebugger(removedTabId), detachDebugger(addedTabId)];
    scheduleTabsSync();
    void runAccessMutation(async () => {
      try {
        await accessReady;
        const replacements = await Promise.allSettled([
          policy.replaceTab(addedTabId, removedTabId),
          replaceTabInSelectedScope(addedTabId, removedTabId),
        ]);
        await Promise.allSettled(detaching);
        const failure = replacements.find((result) => result.status === "rejected");
        if (failure?.status === "rejected") {
          throw failure.reason;
        }
      } finally {
        policy.endRevocation(revocation);
        scheduleTabsSync();
      }
    }).catch(() => undefined);
  });

  const onTabMoved = (tabId) => {
    scheduleTabsSync();
    if (!policy.observeTabMove(tabId)) {
      return;
    }
    const revocation = policy.beginRevocation(tabId);
    const detaching = Promise.resolve().then(() => detachDebugger(tabId));
    void runAccessMutation(async () => {
      try {
        await accessReady;
        const reconciled = await Promise.allSettled([detaching, removeTabFromOpenClawGroup(tabId)]);
        const failure = reconciled.find((result) => result.status === "rejected");
        if (failure?.status === "rejected") {
          throw failure.reason;
        }
      } finally {
        policy.endRevocation(revocation);
        scheduleTabsSync();
      }
    }).catch(() => undefined);
  };
  chromeApi.tabs.onDetached.addListener(onTabMoved);
  chromeApi.tabs.onAttached.addListener(onTabMoved);

  chromeApi.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    scheduleTabsSync();
    const generation = attachments.get(tabId);
    const pendingAttach = generation?.pending;
    if (policy.observeTabUpdate(tabId, changeInfo, tab)) {
      const renewed = policy.renewTabAccess(tabId, generation?.epoch, tab, changeInfo);
      if (renewed && generation) {
        generation.epoch = renewed;
      }
    }
    const eventEpoch = policy.capture(tabId);
    void (async () => {
      await accessReady;
      const eventIsCurrent = () =>
        policy.epochIsCurrent(tabId, eventEpoch) &&
        attachments.get(tabId) === generation &&
        generation?.pending === pendingAttach &&
        !generation?.retired;
      if (!eventIsCurrent()) {
        return;
      }
      const state = await policy.inspectTab(tabId, eventEpoch);
      if (!eventIsCurrent()) {
        return;
      }
      if (!state.accessible) {
        await detachDebugger(tabId);
        return;
      }
      if (generation?.epoch) {
        generation.epoch = eventEpoch;
      }
    })();
  });

  const onGroupChanged = (group, removed = false) => {
    if (policy.mode === ACCESS_MODE_SELECTED && !selectedTabsUseGroups()) {
      return;
    }
    const eventRevision = ++groupEventRevision;
    scheduleTabsSync();
    policy.invalidateGroup(group, removed);
    if (policy.mode !== ACCESS_MODE_SELECTED) {
      return;
    }
    const eventIsCurrent = () =>
      eventRevision === groupEventRevision &&
      policy.mode === ACCESS_MODE_SELECTED &&
      selectedTabsUseGroups();
    const generations = [...attachments]
      .filter(([, record]) => !record.retired)
      .map(([tabId, generation]) => [tabId, generation, policy.capture(tabId)]);
    void accessReady.then(async () => {
      if (!eventIsCurrent()) {
        return;
      }
      await Promise.allSettled([...attachments.values()].map((record) => record.pending));
      if (!eventIsCurrent()) {
        return;
      }
      const selected = new Set((await policy.listAccessibleTabs()).map((tab) => tab.id));
      if (!eventIsCurrent()) {
        return;
      }
      await Promise.allSettled(
        generations
          .filter(
            ([tabId, generation]) => !selected.has(tabId) && attachments.get(tabId) === generation,
          )
          .map(([tabId]) => detachDebugger(tabId)),
      );
      if (!eventIsCurrent()) {
        return;
      }
      for (const [tabId, generation, epoch] of generations) {
        if (!selected.has(tabId) || attachments.get(tabId) !== generation) {
          continue;
        }
        const state = await policy.inspectTab(tabId, epoch);
        if (!eventIsCurrent() || attachments.get(tabId) !== generation) {
          return;
        }
        if (!policy.epochIsCurrent(tabId, epoch)) {
          // The newer tab event owns validation. Replaying this old group event
          // would revoke commands admitted after that validation completed.
          continue;
        }
        if (state.accessible) {
          generation.epoch = epoch;
        } else {
          await detachDebugger(tabId);
          if (!eventIsCurrent()) {
            return;
          }
        }
      }
    });
  };
  chromeApi.tabGroups.onUpdated.addListener(onGroupChanged);
  chromeApi.tabGroups.onRemoved.addListener((group) => onGroupChanged(group, true));
}
