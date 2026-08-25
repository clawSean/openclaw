// Popup: pairing, connection status, and per-tab share toggle.

const statusDot = document.getElementById("statusDot");
const pairSection = document.getElementById("pairSection");
const connectedSection = document.getElementById("connectedSection");
const pairingInput = document.getElementById("pairingString");
const pairButton = document.getElementById("pairButton");
const unpairButton = document.getElementById("unpairButton");
const shareButton = document.getElementById("shareButton");
const statusLine = document.getElementById("statusLine");
const errorLine = document.getElementById("error");
const MESSAGE_TIMEOUT_MS = 5000;

const STATE_LABEL = {
  on: "Connected to OpenClaw",
  connecting: "Connecting…",
  error: "Relay unreachable — is the OpenClaw gateway running?",
  off: "Not connected",
};

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab ?? null;
}

async function sendMessage(message) {
  let timeoutId;
  try {
    return await Promise.race([
      chrome.runtime.sendMessage(message),
      new Promise((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error("The extension worker did not respond.")),
          MESSAGE_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    clearTimeout(timeoutId);
  }
}

function showError(error) {
  errorLine.textContent = error instanceof Error ? error.message : String(error);
  errorLine.classList.remove("hidden");
}

async function refresh() {
  const status = await sendMessage({ type: "getStatus" });
  if (!status || status.ok === false) {
    throw new Error(status?.error ?? "Could not read extension status.");
  }
  statusDot.className = `dot ${status.state}`;
  pairSection.classList.toggle("hidden", status.paired);
  connectedSection.classList.toggle("hidden", !status.paired);
  if (!status.paired) {
    return;
  }
  const label = STATE_LABEL[status.state] ?? STATE_LABEL.off;
  statusLine.textContent = `${label} · ${status.sharedTabCount} tab${status.sharedTabCount === 1 ? "" : "s"} shared`;
  const tab = await activeTab();
  if (tab?.id === undefined) {
    shareButton.classList.add("hidden");
    return;
  }
  const result = await sendMessage({ type: "isTabShared", tabId: tab.id });
  if (!result || result.ok === false) {
    throw new Error(result?.error ?? "Could not read tab-sharing status.");
  }
  const { shared } = result;
  shareButton.classList.remove("hidden");
  shareButton.textContent = shared ? "Stop sharing this tab" : "Share this tab with OpenClaw";
  shareButton.dataset.tabId = String(tab.id);
}

async function onPair() {
  errorLine.classList.add("hidden");
  pairButton.disabled = true;
  pairButton.textContent = "Pairing…";
  try {
    const result = await sendMessage({
      type: "pair",
      pairingString: pairingInput.value,
    });
    if (!result?.ok) {
      throw new Error(result?.error ?? "Pairing failed.");
    }
    await refresh();
  } catch (error) {
    showError(error);
  } finally {
    pairButton.disabled = false;
    pairButton.textContent = "Pair";
  }
}

async function onUnpair() {
  errorLine.classList.add("hidden");
  try {
    const result = await sendMessage({ type: "unpair" });
    if (!result?.ok) {
      throw new Error(result?.error ?? "Unpairing failed.");
    }
    await refresh();
  } catch (error) {
    showError(error);
  }
}

async function onToggleShare() {
  errorLine.classList.add("hidden");
  try {
    const tabId = Number.parseInt(shareButton.dataset.tabId ?? "", 10);
    if (Number.isFinite(tabId)) {
      const result = await sendMessage({ type: "toggleShareTab", tabId });
      if (!result?.ok) {
        throw new Error(result?.error ?? "Could not change tab sharing.");
      }
    }
    await refresh();
  } catch (error) {
    showError(error);
  }
}

async function safeRefresh() {
  try {
    await refresh();
  } catch (error) {
    showError(error);
  }
}

pairButton.addEventListener("click", () => void onPair());
unpairButton.addEventListener("click", () => void onUnpair());
shareButton.addEventListener("click", () => void onToggleShare());

void safeRefresh();
setInterval(() => void safeRefresh(), 2000);
