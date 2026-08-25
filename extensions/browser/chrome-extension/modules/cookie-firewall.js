// Practical cookie firewall for the Arc-compatible OpenClaw extension.
//
// The stock OpenClaw 2026.7.1 browser stack needs Playwright's Runtime, DOM,
// Accessibility, Input, Page, and screenshot commands. Those remain available.
// This module instead blocks the direct CDP cookie jar APIs, prevents nested
// DevTools sessions from escaping the explicitly shared tab boundary, and
// removes cookie/authentication headers from browser-protocol traffic before
// it is relayed off the Arc machine.
//
// This is risk reduction, not a no-exfiltration proof: arbitrary page
// JavaScript can still read non-HttpOnly document.cookie, web storage, and
// filled form fields on a shared page.

const BLOCKED_COOKIE_METHODS = new Set([
  "Network.getAllCookies",
  "Network.getCookies",
  "Page.getCookies",
  "Storage.getCookies",
]);

// A peer attached to one approved tab must not tunnel raw CDP messages to a
// browser target or attach/create/activate another top-level target.
const BLOCKED_SCOPE_EXPANSION_METHODS = new Set([
  "Browser.close",
  "Target.activateTarget",
  "Target.attachToBrowserTarget",
  "Target.attachToTarget",
  "Target.autoAttachRelated",
  "Target.closeTarget",
  "Target.createBrowserContext",
  "Target.createTarget",
  "Target.disposeBrowserContext",
  "Target.exposeDevToolsProtocol",
  "Target.getTargets",
  "Target.sendMessageToTarget",
]);

const SENSITIVE_HEADER_NAMES = new Set([
  "authorization",
  "cookie",
  "cookie2",
  "proxy-authorization",
  "set-cookie",
  "set-cookie2",
]);

const HEADER_CONTAINER_KEYS = new Set(["headers", "requestheaders", "responseheaders"]);

const RAW_HEADER_TEXT_KEYS = new Set(["headerstext", "requestheaderstext", "responseheaderstext"]);

const COOKIE_ARRAY_KEYS = new Set([
  "associatedcookies",
  "blockedcookies",
  "cookies",
  "exemptedcookies",
]);

const COOKIE_VALUE_KEYS = new Set(["cookie", "cookieline", "rawcookieline"]);

function methodDomain(method) {
  return typeof method === "string" ? method.split(".", 1)[0] : "";
}

function isBlockedNavigationUrl(rawUrl) {
  if (typeof rawUrl !== "string" || !rawUrl) return false;
  try {
    const url = new URL(rawUrl);
    return new Set(["arc:", "chrome:", "chrome-extension:", "devtools:", "file:"]).has(
      url.protocol,
    );
  } catch {
    return true;
  }
}

export function authorizeCdpCommand(method, params = {}) {
  if (typeof method !== "string" || !method.includes(".")) {
    throw new Error("Invalid CDP method.");
  }
  if (BLOCKED_COOKIE_METHODS.has(method) || /\.(?:getAllCookies|getCookies)$/.test(method)) {
    throw new Error(`${method} is blocked by the cookie firewall.`);
  }
  if (BLOCKED_SCOPE_EXPANSION_METHODS.has(method)) {
    throw new Error(`${method} is blocked by the explicit-tab boundary.`);
  }
  if (method === "Page.navigate" && isBlockedNavigationUrl(params?.url)) {
    throw new Error("Navigation to local or browser-internal pages is blocked.");
  }
  if (method === "Target.setAutoAttach") {
    return { method, params: { ...(params ?? {}), flatten: true } };
  }
  return { method, params: params ?? {} };
}

function sanitizeHeaderContainer(value, seen) {
  if (Array.isArray(value)) {
    return value
      .filter(
        (entry) =>
          !SENSITIVE_HEADER_NAMES.has(
            String(entry?.name ?? "")
              .trim()
              .toLowerCase(),
          ),
      )
      .map((entry) => sanitizeProtocolValue(entry, seen));
  }
  if (!value || typeof value !== "object") return {};
  const sanitized = {};
  for (const [name, headerValue] of Object.entries(value)) {
    if (SENSITIVE_HEADER_NAMES.has(name.trim().toLowerCase())) continue;
    sanitized[name] = sanitizeProtocolValue(headerValue, seen);
  }
  return sanitized;
}

function sanitizeProtocolValue(value, seen = new WeakMap()) {
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return seen.get(value);
  if (Array.isArray(value)) {
    const sanitized = [];
    seen.set(value, sanitized);
    for (const entry of value) sanitized.push(sanitizeProtocolValue(entry, seen));
    return sanitized;
  }

  const sanitized = {};
  seen.set(value, sanitized);
  for (const [key, entryValue] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();
    if (RAW_HEADER_TEXT_KEYS.has(normalizedKey)) continue;
    if (COOKIE_ARRAY_KEYS.has(normalizedKey)) {
      sanitized[key] = [];
      continue;
    }
    if (COOKIE_VALUE_KEYS.has(normalizedKey)) continue;
    if (HEADER_CONTAINER_KEYS.has(normalizedKey)) {
      sanitized[key] = sanitizeHeaderContainer(entryValue, seen);
      continue;
    }
    sanitized[key] = sanitizeProtocolValue(entryValue, seen);
  }
  return sanitized;
}

export function sanitizeCdpResult(method, result) {
  const domain = methodDomain(method);
  if (!new Set(["Audits", "Fetch", "Network", "Storage"]).has(domain)) {
    return result ?? {};
  }
  return sanitizeProtocolValue(result ?? {});
}

export function sanitizeCdpEvent(method, params) {
  // A non-flattened Target tunnel can carry serialized CDP replies inside an
  // otherwise innocuous Target event. Commands are forced to flattened mode,
  // and legacy tunnel frames are never relayed.
  if (method === "Target.receivedMessageFromTarget") {
    return null;
  }
  const domain = methodDomain(method);
  if (!new Set(["Audits", "Fetch", "Network", "Storage"]).has(domain)) {
    return params ?? {};
  }
  return sanitizeProtocolValue(params ?? {});
}
