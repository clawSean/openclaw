#!/usr/bin/env node

import fs from "node:fs/promises";
import WebSocket from "ws";
import { evaluateCdpTarget, resolveOpenClawWorker } from "./lib/browser-extension-worker.mjs";

function rawDataToText(data) {
  return Array.isArray(data)
    ? Buffer.concat(data).toString("utf8")
    : Buffer.from(data).toString("utf8");
}

const port = Number.parseInt(process.argv[2] ?? "", 10);
const pairingPath = process.argv[3];
const accessMode = process.argv[4] === "selected" ? "selected" : "all";
const expectedFixtureUrl = process.argv[5];
const extensionId = process.argv[6];
if (!Number.isInteger(port) || !pairingPath) {
  throw new Error(
    "usage: pair-browser-extension.mjs <remote-debugging-port> <pairing-file> [all|selected] [fixture-url] [extension-id]",
  );
}

const pairingFile = (await fs.readFile(pairingPath, "utf8")).trim();
let pairingString = pairingFile;
if (pairingFile.startsWith("{")) {
  const parsed = JSON.parse(pairingFile);
  pairingString = parsed.pairingString ?? parsed.pairing ?? "";
}
if (!pairingString) {
  throw new Error("pairing file is empty");
}

async function browserCommand(method, params = {}) {
  const version = await fetch(`http://127.0.0.1:${port}/json/version`).then((response) =>
    response.json(),
  );
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  const response = new Promise((resolve, reject) => {
    ws.on("message", (data) => {
      const message = JSON.parse(rawDataToText(data));
      if (message.id !== 1) {
        return;
      }
      if (message.error) {
        reject(new Error(message.error.message));
      } else {
        resolve(message.result);
      }
    });
    ws.once("error", reject);
  });
  ws.send(JSON.stringify({ id: 1, method, params }));
  try {
    return await response;
  } finally {
    ws.close();
  }
}

async function waitForFixture() {
  if (!expectedFixtureUrl) return null;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const { target } = await resolveOpenClawWorker(port, extensionId);
    const result = await evaluateCdpTarget(
      target,
      `(async () => (await chrome.tabs.query({})).filter((tab) =>
        tab.url === ${JSON.stringify(expectedFixtureUrl)} &&
        tab.status === "complete" &&
        tab.incognito !== true
      ).map((tab) => ({ id: tab.id, url: tab.url })))()`,
    );
    const matches = result?.result?.value ?? [];
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) throw new Error("Multiple matching fixture tabs found");
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Expected fixture tab did not become visible to chrome.tabs");
}

const fixtureTab = await waitForFixture();
const resolved = await resolveOpenClawWorker(port, extensionId);
const resolvedExtensionId = resolved.identity.id;
const optionsUrl = `chrome-extension://${resolvedExtensionId}/options.html`;
await browserCommand("Target.createTarget", { url: optionsUrl });
let optionsTarget;
for (let attempt = 0; attempt < 50; attempt += 1) {
  const refreshedTargets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) =>
    response.json(),
  );
  optionsTarget = refreshedTargets.find((entry) => entry.url === optionsUrl);
  if (optionsTarget) {
    break;
  }
  await new Promise((resolve) => {
    setTimeout(resolve, 100);
  });
}
if (!optionsTarget) {
  throw new Error("OpenClaw extension options page did not open");
}

const expression = `
    (async () => {
      const result = await chrome.runtime.sendMessage({
        type: "pair",
        pairingString: ${JSON.stringify(pairingString)},
        accessMode: ${JSON.stringify(accessMode)},
      });
      if (result?.ok !== true) {
        return { pairOk: false, pairError: String(result?.error ?? "unknown") };
      }
      const fixtureTabId = ${JSON.stringify(fixtureTab?.id ?? null)};
      if (${JSON.stringify(accessMode)} === "selected" && fixtureTabId !== null) {
        const grant = await chrome.runtime.sendMessage({
          type: "toggleTabAccess",
          tabId: fixtureTabId,
          accessMode: "selected",
          grant: true,
        });
        if (grant?.ok !== true) {
          return { pairOk: false, pairError: String(grant?.error ?? "fixture grant failed") };
        }
      }
      const deadline = Date.now() + 30_000;
      let status;
      let fixtureAccess = null;
      while (Date.now() < deadline) {
        status = await chrome.runtime.sendMessage({ type: "getStatus" });
        fixtureAccess = fixtureTabId === null
          ? null
          : await chrome.runtime.sendMessage({ type: "getTabAccess", tabId: fixtureTabId });
        const fixtureReady = fixtureTabId === null ||
          (fixtureAccess?.eligible === true && fixtureAccess?.accessible === true);
        if (
          status?.paired === true &&
          status?.state === "on" &&
          status?.accessMode === ${JSON.stringify(accessMode)} &&
          fixtureReady
        ) break;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      const ready = status?.paired === true &&
        status?.state === "on" &&
        status?.accessMode === ${JSON.stringify(accessMode)} &&
        (fixtureTabId === null ||
          (fixtureAccess?.eligible === true && fixtureAccess?.accessible === true));
      return {
        pairOk: result?.ok === true && ready,
        pairError: ready ? null : "relay or fixture access did not become ready",
        paired: status?.paired === true,
        state: status?.state ?? null,
        accessMode: status?.accessMode ?? null,
        accessibleTabCount: status?.accessibleTabCount ?? null,
        fixtureReady: fixtureTabId === null ||
          (fixtureAccess?.eligible === true && fixtureAccess?.accessible === true),
      };
    })()
  `;
const result = await evaluateCdpTarget(optionsTarget, expression, 35_000);
console.log(JSON.stringify(result?.result?.value ?? { pairOk: false }, null, 2));
process.exit(result?.result?.value?.pairOk ? 0 : 1);
