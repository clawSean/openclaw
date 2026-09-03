#!/usr/bin/env node

import WebSocket from "ws";

const port = Number.parseInt(process.argv[2] ?? "", 10);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("usage: probe-browser-extension.mjs <remote-debugging-port>");
}

async function cdpEvaluate(webSocketDebuggerUrl, expression) {
  const ws = new WebSocket(webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });

  const id = 1;
  const response = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("CDP Runtime.evaluate timed out after 5000ms"));
      ws.terminate();
    }, 5_000);
    ws.on("message", (data) => {
      const message = JSON.parse(String(data));
      if (message.id !== id) return;
      clearTimeout(timer);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    });
    ws.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });

  ws.send(
    JSON.stringify({
      id,
      method: "Runtime.evaluate",
      params: {
        expression,
        awaitPromise: true,
        returnByValue: true,
      },
    }),
  );

  try {
    return await response;
  } finally {
    ws.close();
  }
}

const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) =>
  response.json(),
);

const expression = `
  (async () => {
    const manifest = chrome.runtime.getManifest();
    if (manifest.name !== "OpenClaw") return null;
    const api = {
      debugger: typeof chrome.debugger?.attach === "function",
      tabs: typeof chrome.tabs?.query === "function",
      tabGroups: typeof chrome.tabGroups?.query === "function",
      storageLocal: typeof chrome.storage?.local?.get === "function",
      storageSession: typeof chrome.storage?.session?.get === "function",
      alarms: typeof chrome.alarms?.create === "function",
      nativeMessaging: typeof chrome.runtime?.connectNative === "function",
    };
    let tabGroupsQuery = { ok: false, error: "unavailable" };
    if (api.tabGroups) {
      try {
        const groups = await chrome.tabGroups.query({});
        tabGroupsQuery = { ok: true, count: groups.length };
      } catch (error) {
        tabGroupsQuery = { ok: false, error: String(error?.message ?? error) };
      }
    }
    const tabs = await chrome.tabs.query({});
    const storage = await chrome.storage.local.get([
      "relayUrl",
      "accessMode",
      "nativeBootstrapState",
      "nativeBootstrapFailureCode",
    ]);
    return {
      id: chrome.runtime.id,
      name: manifest.name,
      version: manifest.version,
      api,
      tabGroupsQuery,
      tabCount: tabs.length,
      storage: {
        paired: typeof storage.relayUrl === "string" && storage.relayUrl.length > 0,
        accessMode: storage.accessMode ?? null,
        nativeBootstrapState: storage.nativeBootstrapState ?? null,
        nativeBootstrapFailureCode: storage.nativeBootstrapFailureCode ?? null,
      },
      userAgent: navigator.userAgent,
    };
  })()
`;

const probes = [];
for (const target of targets.filter((entry) => entry.type === "service_worker")) {
  try {
    const result = await cdpEvaluate(target.webSocketDebuggerUrl, expression);
    const value = result?.result?.value ?? null;
    if (value) probes.push(value);
  } catch (error) {
    probes.push({ target: target.url, probeError: String(error?.message ?? error) });
  }
}

const statusTargets = targets.filter(
  (entry) =>
    entry.type === "page" &&
    entry.url.startsWith("chrome-extension://") &&
    entry.url.endsWith("/options.html"),
);
const statuses = [];
for (const target of statusTargets) {
  try {
    const result = await cdpEvaluate(
      target.webSocketDebuggerUrl,
      `(async () => {
        const status = await chrome.runtime.sendMessage({ type: "getStatus" });
        return {
          paired: status?.paired === true,
          state: status?.state ?? null,
          accessMode: status?.accessMode ?? null,
          accessibleTabCount: status?.accessibleTabCount ?? null,
          hint: status?.hint ?? null,
          custodyBlocked: status?.retiredCopilotCustodyBlocked === true,
        };
      })()`,
    );
    statuses.push(result?.result?.value ?? null);
  } catch (error) {
    statuses.push({ probeError: String(error?.message ?? error) });
  }
}

console.log(
  JSON.stringify(
    {
      port,
      pageTargets: targets.filter((entry) => entry.type === "page").length,
      openclawExtensions: probes,
      statuses,
    },
    null,
    2,
  ),
);
