const statusLine = document.getElementById("status");
const pairedDetails = document.getElementById("pairedDetails");
const accessMode = document.getElementById("accessMode");
const shareOnly = document.getElementById("shareOnly");
const tabAction = document.getElementById("tabAction");
const connectionAction = document.getElementById("connectionAction");
const settings = document.getElementById("settings");
const errorLine = document.getElementById("error");
const TRANSIENT_REFRESH_INTERVAL_MS = 250;
const TRANSIENT_REFRESH_WINDOW_MS = 12_000;

let transientRefreshTimer = null;
let transientRefreshDeadline = 0;

function updateTransientRefresh(status) {
  if (transientRefreshTimer !== null) {
    clearTimeout(transientRefreshTimer);
    transientRefreshTimer = null;
  }
  const waitingForRelay =
    status?.paired === true &&
    status.connectionEnabled === true &&
    status.scopeCleanupPending !== true &&
    status.state === "connecting";
  if (!waitingForRelay) {
    transientRefreshDeadline = 0;
    return;
  }
  if (transientRefreshDeadline === 0) {
    transientRefreshDeadline = Date.now() + TRANSIENT_REFRESH_WINDOW_MS;
  }
  const remaining = transientRefreshDeadline - Date.now();
  if (remaining <= 0) {
    transientRefreshDeadline = 0;
    return;
  }
  transientRefreshTimer = setTimeout(
    () => {
      transientRefreshTimer = null;
      void refresh();
    },
    Math.min(TRANSIENT_REFRESH_INTERVAL_MS, remaining),
  );
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab ?? null;
}

function unpairedLabel(nativeBootstrap) {
  if (nativeBootstrap?.disabled) {
    return "Automatic setup disabled";
  }
  if (nativeBootstrap?.state === "manual_required") {
    return "Manual setup required";
  }
  return "Waiting for local OpenClaw";
}

async function refresh() {
  const status = await chrome.runtime.sendMessage({ type: "getStatus" });
  if (status?.ok === false) {
    updateTransientRefresh(null);
    statusLine.textContent = status.error ?? "Could not read browser status.";
    return;
  }
  updateTransientRefresh(status);
  pairedDetails.classList.toggle("hidden", !status.paired);
  if (status.retiredCopilotCustodyBlocked === true) {
    statusLine.textContent = "Automation paused; open Settings";
    shareOnly.classList.add("hidden");
    tabAction.classList.add("hidden");
    connectionAction.classList.add("hidden");
    return;
  }
  if (!status.paired) {
    statusLine.textContent = unpairedLabel(status.nativeBootstrap);
    shareOnly.classList.add("hidden");
    tabAction.classList.add("hidden");
    connectionAction.classList.add("hidden");
    return;
  }
  statusLine.textContent = status.scopeCleanupPending
    ? "Tab handoff incomplete — Sean disconnected"
    : !status.connectionEnabled
      ? "Disconnected — pairing saved"
      : status.state === "on"
        ? "Connected to Sean"
        : status.state === "connecting"
          ? "Connecting to Sean…"
          : "Sean relay unavailable";
  accessMode.textContent = status.accessMode === "selected" ? "Selected tabs" : "All tabs";
  connectionAction.classList.toggle("hidden", status.scopeCleanupPending === true);
  connectionAction.classList.remove("primary", "danger");
  connectionAction.textContent = status.connectionEnabled
    ? "Disconnect Sean (keep pairing)"
    : "Reconnect Sean";
  connectionAction.classList.add(status.connectionEnabled ? "danger" : "primary");
  connectionAction.dataset.enable = String(!status.connectionEnabled);
  if (!status.connectionEnabled) {
    tabAction.classList.add("hidden");
    if (!status.scopeCleanupPending) {
      shareOnly.classList.add("hidden");
      return;
    }
    const tab = await activeTab();
    if (tab?.id === undefined) {
      shareOnly.classList.add("hidden");
      return;
    }
    shareOnly.classList.remove("hidden");
    shareOnly.dataset.tabId = String(tab.id);
    return;
  }
  const tab = await activeTab();
  if (tab?.id === undefined) {
    shareOnly.classList.add("hidden");
    tabAction.classList.add("hidden");
    return;
  }
  const access = await chrome.runtime.sendMessage({ type: "getTabAccess", tabId: tab.id });
  shareOnly.classList.toggle("hidden", !access.eligible);
  shareOnly.dataset.tabId = String(tab.id);
  tabAction.classList.toggle("hidden", !access.eligible);
  tabAction.textContent = access.accessible ? "Pause on this tab" : "Allow on this tab";
  tabAction.dataset.tabId = String(tab.id);
  tabAction.dataset.mode = status.accessMode;
  tabAction.dataset.grant = String(!access.accessible);
}

async function runAction(message) {
  errorLine.classList.add("hidden");
  try {
    const result = await chrome.runtime.sendMessage(message);
    if (!result?.ok) {
      throw new Error(result?.error ?? "Could not update tab access.");
    }
  } catch (error) {
    errorLine.textContent = error instanceof Error ? error.message : String(error);
    errorLine.classList.remove("hidden");
  }
  await refresh();
}

tabAction.addEventListener("click", () => {
  void runAction({
    type: "toggleTabAccess",
    tabId: Number(tabAction.dataset.tabId),
    accessMode: tabAction.dataset.mode,
    grant: tabAction.dataset.grant === "true",
  });
});

shareOnly.addEventListener("click", () => {
  void runAction({ type: "shareOnlyTab", tabId: Number(shareOnly.dataset.tabId) });
});

connectionAction.addEventListener("click", () => {
  void runAction({
    type: "setConnectionEnabled",
    enabled: connectionAction.dataset.enable === "true",
  });
});

settings.addEventListener("click", () => chrome.runtime.openOptionsPage());
void refresh();
