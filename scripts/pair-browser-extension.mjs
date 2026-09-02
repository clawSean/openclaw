#!/usr/bin/env node

import fs from "node:fs/promises";
import WebSocket from "ws";

const port = Number.parseInt(process.argv[2] ?? "", 10);
const pairingPath = process.argv[3];
const accessMode = process.argv[4] === "selected" ? "selected" : "all";
if (!Number.isInteger(port) || !pairingPath) {
  throw new Error(
    "usage: pair-browser-extension.mjs <remote-debugging-port> <pairing-file> [all|selected]",
  );
}

const pairingFile = (await fs.readFile(pairingPath, "utf8")).trim();
let pairingString = pairingFile;
if (pairingFile.startsWith("{")) {
  const parsed = JSON.parse(pairingFile);
  pairingString = parsed.pairingString ?? parsed.pairing ?? "";
}
if (!pairingString) throw new Error("pairing file is empty");

const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) =>
  response.json(),
);

async function evaluate(target, expression) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  const response = new Promise((resolve, reject) => {
    ws.on("message", (data) => {
      const message = JSON.parse(String(data));
      if (message.id !== 1) return;
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    });
    ws.once("error", reject);
  });
  ws.send(
    JSON.stringify({
      id: 1,
      method: "Runtime.evaluate",
      params: { expression, awaitPromise: true, returnByValue: true },
    }),
  );
  try {
    return await response;
  } finally {
    ws.close();
  }
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
      const message = JSON.parse(String(data));
      if (message.id !== 1) return;
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
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

for (const target of targets.filter((entry) => entry.type === "service_worker")) {
  const identity = await evaluate(
    target,
    `({ name: chrome.runtime.getManifest().name, id: chrome.runtime.id })`,
  ).catch(() => null);
  if (identity?.result?.value?.name !== "OpenClaw") continue;

  const extensionId = identity.result.value.id;
  const optionsUrl = `chrome-extension://${extensionId}/options.html`;
  await browserCommand("Target.createTarget", { url: optionsUrl });
  let optionsTarget;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const refreshedTargets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) =>
      response.json(),
    );
    optionsTarget = refreshedTargets.find((entry) => entry.url === optionsUrl);
    if (optionsTarget) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!optionsTarget) throw new Error("OpenClaw extension options page did not open");

  const expression = `
    (async () => {
      const result = await chrome.runtime.sendMessage({
        type: "pair",
        pairingString: ${JSON.stringify(pairingString)},
        accessMode: ${JSON.stringify(accessMode)},
      });
      const status = await chrome.runtime.sendMessage({ type: "getStatus" });
      return {
        pairOk: result?.ok === true,
        pairError: result?.ok === false ? String(result.error ?? "unknown") : null,
        paired: status?.paired === true,
        state: status?.state ?? null,
        accessMode: status?.accessMode ?? null,
        accessibleTabCount: status?.accessibleTabCount ?? null,
      };
    })()
  `;
  const result = await evaluate(optionsTarget, expression);
  console.log(JSON.stringify(result?.result?.value ?? { pairOk: false }, null, 2));
  process.exit(result?.result?.value?.pairOk ? 0 : 1);
}

throw new Error("OpenClaw extension service worker not found");
