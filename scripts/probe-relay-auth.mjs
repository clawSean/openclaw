#!/usr/bin/env node

import fs from "node:fs/promises";
import WebSocket from "ws";
import { createExtensionRelayAuthClient } from "../extensions/browser/chrome-extension/modules/relay-auth-v2.js";
import { parsePairingString } from "../extensions/browser/chrome-extension/modules/relay-core.js";

const pairingPath = process.argv[2];
if (!pairingPath) throw new Error("usage: probe-relay-auth.mjs <pairing-json-file>");
const stored = JSON.parse(await fs.readFile(pairingPath, "utf8"));
const pairing = parsePairingString(stored.pairingString ?? stored.pairing ?? "");
if (!pairing) throw new Error("invalid pairing file");

const auth = await createExtensionRelayAuthClient({
  token: pairing.token,
  relayUrl: pairing.relayUrl,
});
const ws = new WebSocket(pairing.relayUrl, ["openclaw-extension-relay.v2"], {
  origin: "chrome-extension://compatibility-probe",
});

const result = await new Promise((resolve) => {
  const timeout = setTimeout(() => {
    ws.terminate();
    resolve({ ok: false, stage: "timeout" });
  }, 10_000);
  ws.on("open", () => {
    if (ws.protocol !== "openclaw-extension-relay.v2") {
      clearTimeout(timeout);
      resolve({ ok: false, stage: "subprotocol", negotiated: ws.protocol || null });
      ws.close();
      return;
    }
    ws.send(JSON.stringify(auth.start()));
  });
  ws.on("message", async (data) => {
    try {
      const message = JSON.parse(String(data));
      if (message.type === "auth.challenge") {
        ws.send(JSON.stringify(await auth.acceptChallenge(message)));
        return;
      }
      if (message.type === "auth.ok") {
        await auth.acceptOk(message);
        clearTimeout(timeout);
        resolve({ ok: true, stage: "authenticated", negotiated: ws.protocol });
        ws.close();
      }
    } catch (error) {
      clearTimeout(timeout);
      resolve({ ok: false, stage: "auth", error: String(error?.message ?? error) });
      ws.close();
    }
  });
  ws.on("unexpected-response", (_request, response) => {
    clearTimeout(timeout);
    resolve({ ok: false, stage: "http", statusCode: response.statusCode ?? null });
  });
  ws.on("error", (error) => {
    clearTimeout(timeout);
    resolve({ ok: false, stage: "socket", error: String(error.message) });
  });
});

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
