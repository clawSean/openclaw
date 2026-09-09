import fs from "node:fs/promises";
import WebSocket from "ws";

const manifestUrl = new URL(
  "../../extensions/browser/chrome-extension/manifest.json",
  import.meta.url,
);
const expectedManifest = JSON.parse(await fs.readFile(manifestUrl, "utf8"));

function rawDataToText(data) {
  return Array.isArray(data)
    ? Buffer.concat(data).toString("utf8")
    : Buffer.from(data).toString("utf8");
}

export async function fetchBrowserTargets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!response.ok) throw new Error(`CDP target list failed (${response.status})`);
  return await response.json();
}

export async function evaluateCdpTarget(target, expression, timeoutMs = 5_000) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  const response = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error(`CDP Runtime.evaluate timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    ws.on("message", (data) => {
      const message = JSON.parse(rawDataToText(data));
      if (message.id !== 1) return;
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

export async function resolveOpenClawWorker(port, extensionId) {
  const matches = [];
  const targets = await fetchBrowserTargets(port);
  for (const target of targets.filter((entry) => entry.type === "service_worker")) {
    const result = await evaluateCdpTarget(
      target,
      `(() => {
        const manifest = chrome.runtime.getManifest();
        return {
          id: chrome.runtime.id,
          manifestVersion: manifest.manifest_version,
          name: manifest.name,
          version: manifest.version,
          serviceWorker: manifest.background?.service_worker ?? null,
        };
      })()`,
    ).catch(() => null);
    const identity = result?.result?.value;
    if (
      !identity ||
      identity.manifestVersion !== expectedManifest.manifest_version ||
      identity.name !== expectedManifest.name ||
      identity.version !== expectedManifest.version ||
      identity.serviceWorker !== expectedManifest.background?.service_worker ||
      (extensionId && identity.id !== extensionId)
    ) {
      continue;
    }
    const expectedUrl = `chrome-extension://${identity.id}/${identity.serviceWorker}`;
    if (target.url === expectedUrl) matches.push({ target, identity });
  }

  if (matches.length === 0) {
    throw new Error(
      `OpenClaw ${expectedManifest.version} service worker not found${extensionId ? ` for ${extensionId}` : ""}`,
    );
  }
  if (matches.length > 1) {
    throw new Error("Multiple matching OpenClaw workers found; pass an explicit extension id");
  }
  return matches[0];
}
