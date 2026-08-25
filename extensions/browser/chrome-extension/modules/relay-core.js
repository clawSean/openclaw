// Pure helpers for the OpenClaw extension: pairing-string parsing, reconnect
// backoff, and relay tab normalization. No chrome.* usage here so the
// repo's vitest suite can exercise the logic directly.

/** Shared-tab label used in consent and error messages. */
export const OPENCLAW_TAB_GROUP_TITLE = "OpenClaw";
export const EXTENSION_RELAY_PROTOCOL = "openclaw-extension-relay";
export const PINNED_RELAY_URL = "wss://replace-me.invalid/browser/extension";
const EXTENSION_RELAY_TOKEN_PROTOCOL_PREFIX = "openclaw-extension-token.";

/**
 * Parse a pairing string printed by `openclaw browser extension pair`.
 * This build accepts only the exact relay endpoint selected at build time.
 * Shape: wss://your-gateway.example/browser/extension#<token>
 * Returns { relayUrl, token } or null when malformed.
 */
export function parsePairingString(raw) {
  const trimmed = String(raw ?? "").trim();
  const hashIndex = trimmed.indexOf("#");
  if (hashIndex <= 0) {
    return null;
  }
  const relayUrl = trimmed.slice(0, hashIndex);
  const token = trimmed.slice(hashIndex + 1).trim();
  if (!token || token.length > 512 || !/^[A-Za-z0-9._~-]+$/.test(token)) {
    return null;
  }
  let parsed;
  try {
    parsed = new URL(relayUrl);
  } catch {
    return null;
  }
  if (
    parsed.protocol !== "wss:" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.port ||
    relayUrl !== PINNED_RELAY_URL ||
    parsed.href !== PINNED_RELAY_URL
  ) {
    return null;
  }
  return { relayUrl: PINNED_RELAY_URL, token };
}

export function isPinnedRelayUrl(relayUrl) {
  return relayUrl === PINNED_RELAY_URL;
}

/** Build WebSocket subprotocols without putting the relay secret in the request URL. */
export function buildRelayWsProtocols(token) {
  return [EXTENSION_RELAY_PROTOCOL, `${EXTENSION_RELAY_TOKEN_PROTOCOL_PREFIX}${token}`];
}

/** Exponential reconnect backoff: 1s, 2s, 4s ... capped at 30s. */
export function reconnectDelayMs(attempt) {
  const capped = Math.min(Math.max(0, attempt), 5);
  return Math.min(1000 * 2 ** capped, 30_000);
}

/** Normalize a chrome.tabs.Tab into the relay's tab info shape. */
export function toRelayTabInfo(tab) {
  return {
    tabId: tab.id,
    url: tab.url ?? "",
    title: tab.title ?? "",
    active: tab.active === true,
  };
}
