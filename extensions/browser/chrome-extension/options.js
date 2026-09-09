import { accessStatusText, pairingStatusText, relayStatusText } from "./modules/options-status.js";

const pairingStatus = document.getElementById("pairingStatus");
const connectionStatus = document.getElementById("connectionStatus");
const accessStatus = document.getElementById("accessStatus");
const bootstrapStatus = document.getElementById("bootstrapStatus");
const automaticSetup = document.getElementById("automaticSetup");
const accessMode = document.getElementById("accessMode");
const pairingString = document.getElementById("pairingString");
const pair = document.getElementById("pair");
const useLocal = document.getElementById("useLocal");
const connectionAction = document.getElementById("connectionAction");
const disconnect = document.getElementById("disconnect");
const message = document.getElementById("message");
const retiredCustody = document.getElementById("retiredCustody");
const STATUS_REFRESH_INTERVAL_MS = 1_000;

let scheduledRefreshTimer = null;
let refreshGeneration = 0;
let statusErrorActive = false;

function clearScheduledRefresh() {
  if (scheduledRefreshTimer !== null) {
    clearTimeout(scheduledRefreshTimer);
    scheduledRefreshTimer = null;
  }
}

function scheduleRefresh() {
  clearScheduledRefresh();
  if (document.visibilityState !== "visible") {
    return;
  }
  scheduledRefreshTimer = setTimeout(() => {
    scheduledRefreshTimer = null;
    void refresh();
  }, STATUS_REFRESH_INTERVAL_MS);
}

function failControlsClosed() {
  automaticSetup.disabled = true;
  useLocal.disabled = true;
  connectionAction.disabled = true;
  accessMode.disabled = true;
  pairingString.disabled = true;
  pair.disabled = true;
  disconnect.disabled = true;
}

async function refresh() {
  const generation = ++refreshGeneration;
  clearScheduledRefresh();
  try {
    const status = await chrome.runtime.sendMessage({ type: "getStatus" });
    if (generation !== refreshGeneration) {
      return;
    }
    if (status?.ok === false) {
      throw new Error(status.error ?? "Could not read browser status.");
    }
    if (statusErrorActive) {
      message.textContent = "";
      statusErrorActive = false;
    }
    const custodyBlocked = status.retiredCopilotCustodyBlocked === true;
    const automaticSetupLocked = status.nativeBootstrap?.automaticSetupLocked === true;
    retiredCustody.classList.toggle("hidden", !custodyBlocked);
    pairingStatus.textContent = pairingStatusText(status);
    connectionStatus.textContent = relayStatusText(status);
    accessStatus.textContent = accessStatusText(status);
    automaticSetup.checked =
      !status.nativeBootstrap?.disabled && !custodyBlocked && !automaticSetupLocked;
    bootstrapStatus.textContent = custodyBlocked
      ? "Retired recovery state requires confirmation"
      : automaticSetupLocked
        ? "Manual pairing active; forget pairing before local setup"
        : status.nativeBootstrap?.disabled
          ? "Automatic local setup disabled"
          : status.nativeBootstrap?.state === "manual_required"
            ? `Manual setup required (${status.nativeBootstrap.failureCode ?? "unsupported topology"})`
            : status.nativeBootstrap?.state === "retrying"
              ? "Waiting for the local native host"
              : "Automatic bootstrap ready";
    accessMode.value = status.accessMode === "selected" ? "selected" : "all";
    automaticSetup.disabled = custodyBlocked || status.scopeCleanupPending || automaticSetupLocked;
    useLocal.disabled = custodyBlocked || status.scopeCleanupPending || automaticSetupLocked;
    useLocal.title = automaticSetupLocked
      ? "Forget the manual pairing before switching to local OpenClaw."
      : "";
    connectionAction.disabled = !status.paired || custodyBlocked || status.scopeCleanupPending;
    connectionAction.textContent = status.connectionEnabled
      ? "Disconnect Sean (keep pairing)"
      : "Reconnect Sean";
    connectionAction.classList.toggle("danger", status.connectionEnabled === true);
    connectionAction.classList.toggle("primary", status.connectionEnabled !== true);
    connectionAction.dataset.enable = String(!status.connectionEnabled);
    accessMode.disabled = !status.paired || custodyBlocked || status.scopeCleanupPending;
    pairingString.disabled = custodyBlocked || status.scopeCleanupPending;
    pair.disabled = custodyBlocked || status.scopeCleanupPending;
    disconnect.disabled = !status.paired && !custodyBlocked;
  } catch (error) {
    if (generation !== refreshGeneration) {
      return;
    }
    pairingStatus.textContent = "Unknown";
    connectionStatus.textContent = "Status unavailable";
    accessStatus.textContent = "Unknown";
    bootstrapStatus.textContent = "Status unavailable";
    message.textContent = error instanceof Error ? error.message : String(error);
    statusErrorActive = true;
    failControlsClosed();
  } finally {
    if (generation === refreshGeneration) {
      scheduleRefresh();
    }
  }
}

async function showResult(task, success) {
  try {
    const result = await task();
    if (result?.ok === false) {
      throw new Error(result.error ?? "Operation failed.");
    }
    message.textContent = success;
  } catch (error) {
    message.textContent = error instanceof Error ? error.message : String(error);
  }
  await refresh();
}

automaticSetup.addEventListener("change", () => {
  void showResult(
    () =>
      chrome.runtime.sendMessage({
        type: "setNativeBootstrapEnabled",
        enabled: automaticSetup.checked,
      }),
    automaticSetup.checked ? "Automatic setup enabled." : "Automatic setup disabled.",
  );
});
useLocal.addEventListener("click", () => {
  void showResult(
    () => chrome.runtime.sendMessage({ type: "setNativeBootstrapEnabled", enabled: true }),
    "Looking for local OpenClaw…",
  );
});
connectionAction.addEventListener("click", () => {
  const enabled = connectionAction.dataset.enable === "true";
  void showResult(
    () => chrome.runtime.sendMessage({ type: "setConnectionEnabled", enabled }),
    enabled ? "Reconnect requested." : "Sean disconnected. Pairing was kept.",
  );
});
accessMode.addEventListener("change", () => {
  void showResult(
    () => chrome.runtime.sendMessage({ type: "setAccessMode", accessMode: accessMode.value }),
    "Access mode updated.",
  );
});
pair.addEventListener("click", () => {
  void showResult(async () => {
    const result = await chrome.runtime.sendMessage({
      type: "pair",
      pairingString: pairingString.value,
      accessMode: accessMode.value,
    });
    if (result?.ok !== false) {
      pairingString.value = "";
    }
    return result;
  }, "Manual pairing saved.");
});
disconnect.addEventListener("click", () => {
  void showResult(
    () => chrome.runtime.sendMessage({ type: "unpair" }),
    "Pairing forgotten. Automatic setup is disabled.",
  );
});

window.addEventListener("focus", () => void refresh());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    void refresh();
  } else {
    clearScheduledRefresh();
  }
});
window.addEventListener("pagehide", clearScheduledRefresh);
void refresh();
