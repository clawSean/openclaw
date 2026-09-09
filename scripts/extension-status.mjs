#!/usr/bin/env node

import { evaluateCdpTarget, resolveOpenClawWorker } from "./lib/browser-extension-worker.mjs";

const port = Number.parseInt(process.argv[2] ?? "", 10);
const extensionId = process.argv[3];
if (!Number.isInteger(port)) {
  throw new Error("usage: extension-status.mjs <remote-debugging-port> [extension-id]");
}

const { target } = await resolveOpenClawWorker(port, extensionId);

const result = await evaluateCdpTarget(
  target,
  `(async () => {
      const local = await chrome.storage.local.get(["relayUrl", "accessMode", "nativeBootstrapState", "nativeBootstrapFailureCode"]);
      return {
        id: chrome.runtime.id,
        name: chrome.runtime.getManifest().name,
        version: chrome.runtime.getManifest().version,
        backgroundLoaded: typeof relayState !== "undefined",
        state: typeof relayState !== "undefined" ? relayState : null,
        accessMode: local.accessMode ?? null,
        relayConfigured: typeof local.relayUrl === "string" && local.relayUrl.length > 0,
        nativeBootstrapState: local.nativeBootstrapState ?? null,
        nativeBootstrapFailureCode: local.nativeBootstrapFailureCode ?? null,
      };
    })()`,
);
if (result?.exceptionDetails) {
  throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
}
console.log(JSON.stringify(result?.result?.value ?? null, null, 2));
