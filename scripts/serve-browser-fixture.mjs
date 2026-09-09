#!/usr/bin/env node

import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const port = Number.parseInt(process.argv[2] ?? "19333", 10);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = await fs.readFile(path.join(root, "test/fixtures/browser-e2e.html"));

const server = http.createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
  if (url.pathname === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
    return;
  }
  if (url.pathname === "/set-cookie") {
    response.writeHead(302, {
      location: "/",
      "set-cookie": [
        "openclaw_visible_cookie=visible-canary; Path=/; SameSite=Lax",
        "openclaw_http_only_cookie=http-only-canary; Path=/; HttpOnly; SameSite=Lax",
      ],
    });
    response.end();
    return;
  }
  if (url.pathname === "/second") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(
      "<!doctype html><title>Second fixture</title><h1>Second fixture page</h1><a href='/'>Return</a>",
    );
    return;
  }
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(fixture);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`fixture ready on 127.0.0.1:${port}`);
});
