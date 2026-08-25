import {
  authorizeCdpCommand,
  sanitizeCdpEvent,
  sanitizeCdpResult,
} from "./modules/cookie-firewall.js";
// OpenClaw extension service worker.
//
// Thin transport between the OpenClaw extension relay (loopback WebSocket) and
// chrome.debugger. All CDP target synthesis lives server-side in the relay
// bridge; this worker only attaches tabs, forwards frames, and keeps the
// explicit shared-tab registry in sync. Membership in that registry is the
// consent boundary: only tabs shared from the popup are reported to (and driven
// by) OpenClaw. Arc cannot reliably resolve Chrome's tabGroups promises.
import {
  OPENCLAW_TAB_GROUP_TITLE,
  buildRelayWsProtocols,
  isPinnedRelayUrl,
  parsePairingString,
  reconnectDelayMs,
  toRelayTabInfo,
} from "./modules/relay-core.js";
import { createSharedTabsRegistry } from "./modules/shared-tabs.js";

const BADGE = {
  off: { text: "", color: "#000000" },
  connecting: { text: "…", color: "#F59E0B" },
  on: { text: "ON", color: "#0F9D58" },
  error: { text: "!", color: "#B91C1C" },
};

/** @type {WebSocket|null} */
let relayWs = null;
let relayState = "off"; // off | connecting | on | error
let reconnectAttempt = 0;
let reconnectTimer = null;
// Pair/unpair increments this generation so async work from an older relay
// lifecycle can never regain authority after it yields.
let connectionGeneration = 0;
// Unlike missing credentials, this is an immediate in-memory revocation gate.
// Unpair sets it before any asynchronous cleanup begins.
let connectionsDisabled = false;
// Pair/unpair storage mutations are ordered by message arrival so a delayed
// older Pair write cannot land after a newer Unpair removal.
let configMutationQueue = Promise.resolve();
/** Tab ids with an active chrome.debugger attachment. */
const attachedTabs = new Set();
/** In-flight attach promises per tab id (coalesces concurrent attaches). */
const attachingTabs = new Map();
/** Debounce handle for tab-list refreshes. */
let tabsSyncTimer = null;
const sharedTabsRegistry = createSharedTabsRegistry(chrome);
/** Last per-tab sharing badge applied, to avoid rewriting every tab on updates. */
const sharingBadgeState = new Map();

function setBadge(kind) {
  relayState = kind;
  const cfg = BADGE[kind] ?? BADGE.off;
  void chrome.action.setBadgeText({ text: cfg.text });
  void chrome.action.setBadgeBackgroundColor({ color: cfg.color });
}

async function getConfig() {
  const stored = await chrome.storage.local.get(["relayUrl", "token"]);
  return {
    relayUrl: typeof stored.relayUrl === "string" ? stored.relayUrl : "",
    token: typeof stored.token === "string" ? stored.token : "",
  };
}

async function assertSafeBrowserExtensionSettings() {
  const extensionApi = chrome.extension;
  if (
    !extensionApi ||
    typeof extensionApi.isAllowedFileSchemeAccess !== "function" ||
    typeof extensionApi.isAllowedIncognitoAccess !== "function"
  ) {
    throw new Error("Arc cannot verify the required file/private-window safety settings.");
  }
  const [fileAccess, incognitoAccess] = await Promise.all([
    extensionApi.isAllowedFileSchemeAccess(),
    extensionApi.isAllowedIncognitoAccess(),
  ]);
  if (fileAccess) {
    throw new Error('Turn off "Allow access to file URLs" for this extension before pairing.');
  }
  if (incognitoAccess) {
    throw new Error('Turn off "Allow in Private Browsing" for this extension before pairing.');
  }
}

function assertShareableTabUrl(rawUrl) {
  if (rawUrl === "about:blank") return;
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Only ordinary web tabs can be shared with OpenClaw.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Local, browser-internal, and extension pages cannot be shared.");
  }
}

function isConnectionGenerationCurrent(generation) {
  return !connectionsDisabled && generation === connectionGeneration;
}

function isRelayConnectionCurrent(ws, generation) {
  return relayWs === ws && isConnectionGenerationCurrent(generation);
}

function requireRelayConnectionCurrent(ws, generation) {
  if (!isRelayConnectionCurrent(ws, generation)) {
    throw new Error("relay connection is no longer active");
  }
}

function cancelReconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function enqueueConfigMutation(operation) {
  const mutation = configMutationQueue.then(operation, operation);
  configMutationQueue = mutation.catch(() => {});
  return mutation;
}

// ---------------------------------------------------------------------------
// Shared-tab management (the consent boundary)
// ---------------------------------------------------------------------------

async function listSharedTabs() {
  return await sharedTabsRegistry.list();
}

async function addSharedTab(tabId) {
  await assertSafeBrowserExtensionSettings();
  const tab = await chrome.tabs.get(tabId);
  assertShareableTabUrl(tab.url);
  await sharedTabsRegistry.add(tabId);
}

async function removeSharedTab(tabId) {
  await sharedTabsRegistry.remove(tabId);
}

async function isTabShared(tabId) {
  return await sharedTabsRegistry.has(tabId);
}

function scheduleTabsSync() {
  if (tabsSyncTimer) {
    return;
  }
  tabsSyncTimer = setTimeout(() => {
    tabsSyncTimer = null;
    void syncTabsToRelay().catch(() => {});
  }, 150);
}

async function syncTabsToRelay() {
  const generation = connectionGeneration;
  const shared = await listSharedTabs();
  const sharedIds = new Set(shared.map((tab) => tab.id));
  const allTabs = await chrome.tabs.query({});
  const badgeUpdates = [];
  for (const tab of allTabs) {
    if (typeof tab.id !== "number") {
      continue;
    }
    const text = sharedIds.has(tab.id) ? "SH" : null;
    if (sharingBadgeState.has(tab.id) && sharingBadgeState.get(tab.id) === text) {
      continue;
    }
    badgeUpdates.push(
      chrome.action
        .setBadgeText({
          tabId: tab.id,
          // null clears the tab-specific override and restores the global badge.
          text,
        })
        .then(() => sharingBadgeState.set(tab.id, text)),
    );
  }
  await Promise.allSettled(badgeUpdates);
  const ws = relayWs;
  if (!ws || !isRelayConnectionCurrent(ws, generation) || ws.readyState !== WebSocket.OPEN) {
    return;
  }
  // Detach tabs the user stopped sharing. Revocation clears the per-tab
  // debugger state before the next relay tab list is sent.
  for (const tabId of attachedTabs) {
    if (!sharedIds.has(tabId)) {
      void detachDebugger(tabId);
    }
  }
  sendOnConnection(ws, generation, { type: "tabs", tabs: shared.map(toRelayTabInfo) });
}

// ---------------------------------------------------------------------------
// chrome.debugger transport
// ---------------------------------------------------------------------------

async function attachDebugger(tabId) {
  await assertSafeBrowserExtensionSettings();
  if (!(await isTabShared(tabId))) {
    throw new Error(`tab ${tabId} is not shared with ${OPENCLAW_TAB_GROUP_TITLE}`);
  }
  const tab = await chrome.tabs.get(tabId);
  assertShareableTabUrl(tab.url);
  // Coalesce concurrent attaches for one tab. Two relay attach commands (or an
  // auto-attach racing an explicit share) would otherwise both call
  // chrome.debugger.attach and the second throws "Another debugger is already
  // attached". The bridge and this worker can also disagree after an MV3 restart.
  const inFlight = attachingTabs.get(tabId);
  if (inFlight) {
    return await inFlight;
  }
  const attach = (async () => {
    if (!attachedTabs.has(tabId)) {
      try {
        await chrome.debugger.attach({ tabId }, "1.3");
      } catch (err) {
        // Treat an existing attachment as success; our own debugger is already on.
        if (!String(err?.message ?? err).includes("Another debugger is already attached")) {
          throw err;
        }
      }
    }
    // Consent may have been revoked while chrome.debugger.attach was pending.
    // Re-check before recording or exposing the attachment.
    if (!(await isTabShared(tabId))) {
      try {
        await chrome.debugger.detach({ tabId });
      } catch {
        // already detached or owned elsewhere
      }
      attachedTabs.delete(tabId);
      throw new Error(`tab ${tabId} is no longer shared with ${OPENCLAW_TAB_GROUP_TITLE}`);
    }
    attachedTabs.add(tabId);
    const targets = await chrome.debugger.getTargets();
    const target = targets.find((candidate) => candidate.tabId === tabId && candidate.attached);
    return { targetId: target?.id ?? `tab-${tabId}` };
  })();
  attachingTabs.set(tabId, attach);
  try {
    return await attach;
  } finally {
    attachingTabs.delete(tabId);
  }
}

async function detachDebugger(tabId) {
  attachedTabs.delete(tabId);
  try {
    await chrome.debugger.detach({ tabId });
  } catch {
    // already detached or tab gone
  }
}

async function revokeAllTabAccess() {
  let cleanupError;
  try {
    await sharedTabsRegistry.clear();
  } catch (err) {
    cleanupError = err;
  }
  await Promise.all([...attachedTabs].map((tabId) => detachDebugger(tabId)));
  scheduleTabsSync();
  if (cleanupError) throw cleanupError;
}

async function revokeForUnsafeSettings() {
  connectionsDisabled = true;
  connectionGeneration += 1;
  const generation = connectionGeneration;
  cancelReconnect();
  const previousWs = relayWs;
  relayWs = null;
  try {
    previousWs?.close();
  } catch {
    // already closed
  }
  setBadge("error");
  await revokeAllTabAccess();
  if (generation === connectionGeneration) {
    // Re-enable retry checks. No tab authority survived the revocation.
    connectionsDisabled = false;
  }
}

chrome.debugger.onEvent.addListener((source, method, params) => {
  if (typeof source.tabId !== "number") {
    return;
  }
  // This check must stay synchronous so high-volume CDP events preserve order.
  // Attach waits for registry initialization, and revocation removes cached
  // membership before detaching, so the cache remains a fail-closed guard here.
  if (!attachedTabs.has(source.tabId) || !sharedTabsRegistry.hasCached(source.tabId)) {
    return;
  }
  const sanitizedParams = sanitizeCdpEvent(method, params);
  if (sanitizedParams === null) {
    return;
  }
  send({
    type: "cdpEvent",
    tabId: source.tabId,
    ...(source.sessionId ? { sessionId: source.sessionId } : {}),
    method,
    params: sanitizedParams,
  });
});

chrome.debugger.onDetach.addListener((source, reason) => {
  if (typeof source.tabId !== "number") {
    return;
  }
  attachedTabs.delete(source.tabId);
  if (reason === "canceled_by_user") {
    // The user hit "Cancel" on Chrome's debugging infobar: treat it as a
    // revocation and remove the tab from the shared list so the agent does
    // not immediately re-attach.
    void removeSharedTab(source.tabId).then(
      () => {
        send({ type: "detached", tabId: source.tabId, reason });
        scheduleTabsSync();
      },
      () => {
        send({ type: "detached", tabId: source.tabId, reason });
        scheduleTabsSync();
      },
    );
    return;
  }
  send({ type: "detached", tabId: source.tabId, reason });
});

// ---------------------------------------------------------------------------
// Relay connection
// ---------------------------------------------------------------------------

function sendOnConnection(ws, generation, message) {
  if (isRelayConnectionCurrent(ws, generation) && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function send(message) {
  const ws = relayWs;
  if (ws) {
    sendOnConnection(ws, connectionGeneration, message);
  }
}

async function handleRelayCommand(msg, ws, generation) {
  const { seq } = msg;
  try {
    requireRelayConnectionCurrent(ws, generation);
    switch (msg.type) {
      case "ping":
        sendOnConnection(ws, generation, { type: "pong" });
        return;
      case "attach": {
        const result = await attachDebugger(msg.tabId);
        if (!isRelayConnectionCurrent(ws, generation)) {
          await detachDebugger(msg.tabId);
          return;
        }
        sendOnConnection(ws, generation, { type: "result", seq, result });
        return;
      }
      case "detach": {
        if (!(await isTabShared(msg.tabId))) {
          throw new Error(`tab ${msg.tabId} is not shared with ${OPENCLAW_TAB_GROUP_TITLE}`);
        }
        requireRelayConnectionCurrent(ws, generation);
        await detachDebugger(msg.tabId);
        requireRelayConnectionCurrent(ws, generation);
        sendOnConnection(ws, generation, { type: "result", seq, result: {} });
        return;
      }
      case "cdp": {
        if (!(await isTabShared(msg.tabId))) {
          throw new Error(`tab ${msg.tabId} is not shared with ${OPENCLAW_TAB_GROUP_TITLE}`);
        }
        requireRelayConnectionCurrent(ws, generation);
        const target = msg.sessionId
          ? { tabId: msg.tabId, sessionId: msg.sessionId }
          : { tabId: msg.tabId };
        const authorized = authorizeCdpCommand(msg.method, msg.params ?? {});
        const result = await chrome.debugger.sendCommand(
          target,
          authorized.method,
          authorized.params,
        );
        requireRelayConnectionCurrent(ws, generation);
        sendOnConnection(ws, generation, {
          type: "result",
          seq,
          result: sanitizeCdpResult(authorized.method, result ?? {}),
        });
        return;
      }
      case "createTab": {
        throw new Error(
          "Remote tab creation is disabled. Open the page yourself, then share that tab.",
        );
      }
      case "closeTab": {
        if (!(await isTabShared(msg.tabId))) {
          throw new Error(`tab ${msg.tabId} is not shared with ${OPENCLAW_TAB_GROUP_TITLE}`);
        }
        requireRelayConnectionCurrent(ws, generation);
        await removeSharedTab(msg.tabId);
        requireRelayConnectionCurrent(ws, generation);
        await detachDebugger(msg.tabId);
        requireRelayConnectionCurrent(ws, generation);
        await chrome.tabs.remove(msg.tabId);
        requireRelayConnectionCurrent(ws, generation);
        sendOnConnection(ws, generation, { type: "result", seq, result: {} });
        return;
      }
      case "activateTab": {
        if (!(await isTabShared(msg.tabId))) {
          throw new Error(`tab ${msg.tabId} is not shared with ${OPENCLAW_TAB_GROUP_TITLE}`);
        }
        requireRelayConnectionCurrent(ws, generation);
        const tab = await chrome.tabs.get(msg.tabId);
        requireRelayConnectionCurrent(ws, generation);
        if (!(await isTabShared(msg.tabId))) {
          throw new Error(`tab ${msg.tabId} is no longer shared with ${OPENCLAW_TAB_GROUP_TITLE}`);
        }
        requireRelayConnectionCurrent(ws, generation);
        await chrome.tabs.update(msg.tabId, { active: true });
        requireRelayConnectionCurrent(ws, generation);
        if (typeof tab.windowId === "number") {
          await chrome.windows.update(tab.windowId, { focused: true });
          requireRelayConnectionCurrent(ws, generation);
        }
        sendOnConnection(ws, generation, { type: "result", seq, result: {} });
        return;
      }
      default:
        if (typeof seq === "number") {
          sendOnConnection(ws, generation, {
            type: "error",
            seq,
            message: `unknown relay command: ${msg.type}`,
          });
        }
    }
  } catch (err) {
    if (typeof seq === "number") {
      sendOnConnection(ws, generation, {
        type: "error",
        seq,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

async function sendHello(ws, generation) {
  const shared = await listSharedTabs();
  if (!isRelayConnectionCurrent(ws, generation)) {
    return;
  }
  const uaMatch = /Chrom(?:e|ium)\/[\d.]+/.exec(navigator.userAgent);
  sendOnConnection(ws, generation, {
    type: "hello",
    userAgent: navigator.userAgent,
    browserVersion: uaMatch ? uaMatch[0] : "Chrome/unknown",
    extensionVersion: chrome.runtime.getManifest().version,
    tabs: shared.map(toRelayTabInfo),
  });
}

async function connectRelay() {
  const generation = connectionGeneration;
  if (!isConnectionGenerationCurrent(generation)) {
    return;
  }
  try {
    await assertSafeBrowserExtensionSettings();
  } catch {
    if (isConnectionGenerationCurrent(generation)) {
      await revokeForUnsafeSettings().catch(() => {});
    }
    return;
  }
  if (!isConnectionGenerationCurrent(generation)) {
    return;
  }
  const { relayUrl, token } = await getConfig();
  if (!isConnectionGenerationCurrent(generation)) {
    return;
  }
  if (!relayUrl || !token) {
    setBadge("off");
    return;
  }
  if (!isPinnedRelayUrl(relayUrl)) {
    setBadge("error");
    return;
  }
  if (
    relayWs &&
    (relayWs.readyState === WebSocket.OPEN || relayWs.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }
  setBadge("connecting");
  let ws;
  try {
    if (!isConnectionGenerationCurrent(generation)) {
      return;
    }
    ws = new WebSocket(relayUrl, buildRelayWsProtocols(token));
  } catch {
    if (!isConnectionGenerationCurrent(generation)) {
      return;
    }
    setBadge("error");
    scheduleReconnect(generation);
    return;
  }
  if (!isConnectionGenerationCurrent(generation)) {
    try {
      ws.close();
    } catch {
      // already closed
    }
    return;
  }
  relayWs = ws;
  ws.addEventListener("open", () => {
    if (!isRelayConnectionCurrent(ws, generation)) {
      return;
    }
    reconnectAttempt = 0;
    setBadge("on");
    void sendHello(ws, generation);
  });
  ws.addEventListener("message", (event) => {
    if (!isRelayConnectionCurrent(ws, generation)) {
      return;
    }
    let msg;
    try {
      msg = JSON.parse(String(event.data));
    } catch {
      return;
    }
    void handleRelayCommand(msg, ws, generation);
  });
  ws.addEventListener("close", () => {
    if (!isRelayConnectionCurrent(ws, generation)) {
      return;
    }
    relayWs = null;
    setBadge("error");
    scheduleReconnect(generation);
  });
  // onclose follows onerror and drives the reconnect, so no error handler needed.
}

function scheduleReconnect(generation) {
  if (!isConnectionGenerationCurrent(generation) || reconnectTimer) {
    return;
  }
  const delay = reconnectDelayMs(reconnectAttempt);
  reconnectAttempt += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (!isConnectionGenerationCurrent(generation)) {
      return;
    }
    void connectRelay();
  }, delay);
}

// ---------------------------------------------------------------------------
// Popup messaging + lifecycle
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  void (async () => {
    switch (msg?.type) {
      case "getStatus": {
        const { relayUrl } = await getConfig();
        const shared = await listSharedTabs();
        sendResponse({
          paired: isPinnedRelayUrl(relayUrl),
          state: relayState,
          sharedTabCount: shared.length,
        });
        return;
      }
      case "pair": {
        const parsed = parsePairingString(msg.pairingString);
        if (!parsed) {
          sendResponse({ ok: false, error: "Invalid pairing string." });
          return;
        }
        await assertSafeBrowserExtensionSettings();
        // Re-pairing is a new authority generation. Keep connections disabled
        // until the replacement credentials are durably stored.
        connectionsDisabled = true;
        connectionGeneration += 1;
        const generation = connectionGeneration;
        cancelReconnect();
        const previousWs = relayWs;
        relayWs = null;
        try {
          previousWs?.close();
        } catch {
          // already closed
        }
        await revokeAllTabAccess();
        if (generation !== connectionGeneration) {
          sendResponse({ ok: false, error: "Pairing was superseded." });
          return;
        }
        await enqueueConfigMutation(() =>
          chrome.storage.local.set({
            relayUrl: parsed.relayUrl,
            token: parsed.token,
          }),
        );
        if (generation !== connectionGeneration) {
          sendResponse({ ok: false, error: "Pairing was superseded." });
          return;
        }
        connectionsDisabled = false;
        reconnectAttempt = 0;
        await connectRelay();
        if (!isConnectionGenerationCurrent(generation)) {
          sendResponse({ ok: false, error: "Pairing was superseded." });
          return;
        }
        sendResponse({ ok: true });
        return;
      }
      case "unpair": {
        // Revoke authority synchronously, before any storage, consent, or
        // debugger cleanup can yield to stale connection work.
        connectionsDisabled = true;
        connectionGeneration += 1;
        cancelReconnect();
        const previousWs = relayWs;
        relayWs = null;
        try {
          previousWs?.close();
        } catch {
          // already closed
        }
        setBadge("off");
        let cleanupError;
        try {
          await enqueueConfigMutation(() => chrome.storage.local.remove(["relayUrl", "token"]));
        } catch (err) {
          cleanupError = err;
        }
        try {
          await revokeAllTabAccess();
        } catch (err) {
          cleanupError ??= err;
        }
        if (cleanupError) {
          throw cleanupError;
        }
        sendResponse({ ok: true });
        return;
      }
      case "toggleShareTab": {
        const generation = connectionGeneration;
        const tabId = msg.tabId;
        if (typeof tabId !== "number") {
          sendResponse({ ok: false, error: "No tab." });
          return;
        }
        if (!isConnectionGenerationCurrent(generation)) {
          sendResponse({ ok: false, error: "Connections are disabled." });
          return;
        }
        const wasShared = await isTabShared(tabId);
        if (!isConnectionGenerationCurrent(generation)) {
          sendResponse({ ok: false, error: "Sharing change was superseded." });
          return;
        }
        if (wasShared) {
          await removeSharedTab(tabId);
          await detachDebugger(tabId);
          scheduleTabsSync();
          sendResponse({ ok: true, shared: false });
        } else {
          await addSharedTab(tabId);
          if (!isConnectionGenerationCurrent(generation)) {
            await removeSharedTab(tabId).catch(() => {});
            await detachDebugger(tabId);
            sendResponse({ ok: false, error: "Sharing change was superseded." });
            return;
          }
          scheduleTabsSync();
          sendResponse({ ok: true, shared: true });
        }
        return;
      }
      case "isTabShared": {
        sendResponse({ shared: await isTabShared(msg.tabId) });
        return;
      }
      default:
        sendResponse({ ok: false, error: "unknown message" });
    }
  })().catch((err) => {
    sendResponse({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  });
  return true; // keep sendResponse alive for the async path
});

chrome.tabs.onRemoved.addListener((tabId) => {
  attachedTabs.delete(tabId);
  sharingBadgeState.delete(tabId);
  void removeSharedTab(tabId).then(scheduleTabsSync, scheduleTabsSync);
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (sharedTabsRegistry.hasCached(tabId) && (changeInfo.url || tab?.url)) {
    try {
      assertShareableTabUrl(changeInfo.url ?? tab.url);
    } catch {
      void removeSharedTab(tabId)
        .then(() => detachDebugger(tabId))
        .finally(scheduleTabsSync);
      return;
    }
  }
  scheduleTabsSync();
});

// Watchdog: MV3 can stop this worker; the alarm revives it and re-connects.
chrome.alarms.create("openclaw-relay-watchdog", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "openclaw-relay-watchdog") {
    void connectRelay();
  }
});
chrome.runtime.onStartup.addListener(() => void connectRelay());
chrome.runtime.onInstalled.addListener(() => void connectRelay());
void connectRelay();
scheduleTabsSync();
