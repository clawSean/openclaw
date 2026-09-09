#!/usr/bin/env node

import {
  evaluateCdpTarget,
  fetchBrowserTargets,
  resolveOpenClawWorker,
} from "./lib/browser-extension-worker.mjs";

const port = Number.parseInt(process.argv[2] ?? "", 10);
const expectedFixtureUrl = process.argv[3];
const extensionId = process.argv[4];
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(
    "usage: probe-browser-extension.mjs <remote-debugging-port> [fixture-url] [extension-id]",
  );
}

const targets = await fetchBrowserTargets(port);
const resolved = await resolveOpenClawWorker(port, extensionId);

const expression = `
  (async () => {
    const manifest = chrome.runtime.getManifest();
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
      const timeoutMs = 1_000;
      let timeoutId;
      try {
        const groups = await Promise.race([
          chrome.tabGroups.query({}),
          new Promise((_, reject) => {
            timeoutId = setTimeout(
              () => reject(new Error(\`timed out after \${timeoutMs}ms\`)),
              timeoutMs,
            );
          }),
        ]);
        tabGroupsQuery = { ok: true, count: groups.length };
      } catch (error) {
        tabGroupsQuery = { ok: false, error: String(error?.message ?? error) };
      } finally {
        clearTimeout(timeoutId);
      }
    }
    const tabs = await chrome.tabs.query({});
    const expectedFixtureUrl = ${JSON.stringify(expectedFixtureUrl ?? null)};
    const fixtureTabs = expectedFixtureUrl === null
      ? []
      : tabs.filter((tab) =>
          tab.url === expectedFixtureUrl &&
          tab.status === "complete" &&
          tab.incognito !== true
        );
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
      fixtureTabCount: fixtureTabs.length,
      fixtureTabIds: fixtureTabs.map((tab) => tab.id),
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

const workerResult = await evaluateCdpTarget(resolved.target, expression);
const workerProbe = workerResult?.result?.value ?? null;

const statusTargets = targets.filter(
  (entry) =>
    entry.type === "page" &&
    entry.url.startsWith(`chrome-extension://${resolved.identity.id}/`) &&
    entry.url.endsWith("/options.html"),
);
const statuses = [];
for (const target of statusTargets) {
  try {
    const result = await evaluateCdpTarget(
      target,
      `(async () => {
        const status = await chrome.runtime.sendMessage({ type: "getStatus" });
        return {
          paired: status?.paired === true,
          state: status?.state ?? null,
          accessMode: status?.accessMode ?? null,
          accessibleTabCount: status?.accessibleTabCount ?? null,
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
      openclawExtension: workerProbe,
      statuses,
    },
    null,
    2,
  ),
);

if (expectedFixtureUrl && workerProbe?.fixtureTabCount !== 1) process.exitCode = 1;
