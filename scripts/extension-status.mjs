#!/usr/bin/env node

import WebSocket from "ws";

const port = Number.parseInt(process.argv[2] ?? "", 10);
if (!Number.isInteger(port)) throw new Error("usage: extension-status.mjs <remote-debugging-port>");

const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) =>
  response.json(),
);
const target = targets.find(
  (entry) => entry.type === "service_worker" && entry.url.endsWith("/background.js"),
);
if (!target) throw new Error("OpenClaw service worker not found");

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
    params: {
      expression: `(async () => {
      const local = await chrome.storage.local.get(["relayUrl", "accessMode", "nativeBootstrapState", "nativeBootstrapFailureCode"]);
      return {
        id: chrome.runtime.id,
        version: chrome.runtime.getManifest().version,
        backgroundLoaded: typeof relayState !== "undefined",
        state: typeof relayState !== "undefined" ? relayState : null,
        accessMode: local.accessMode ?? null,
        relayConfigured: typeof local.relayUrl === "string" && local.relayUrl.length > 0,
        nativeBootstrapState: local.nativeBootstrapState ?? null,
        nativeBootstrapFailureCode: local.nativeBootstrapFailureCode ?? null,
      };
    })()`,
      awaitPromise: true,
      returnByValue: true,
    },
  }),
);
const result = await response;
ws.close();
if (result?.exceptionDetails) {
  throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
}
console.log(JSON.stringify(result?.result?.value ?? null, null, 2));
