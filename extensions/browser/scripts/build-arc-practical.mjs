import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const sourceDir = path.resolve(here, "..", "chrome-extension");

function readArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value) {
      throw new Error("Expected --relay-url, --output, and optional --name values.");
    }
    values.set(key.slice(2), value);
  }
  return values;
}

function validateRelayUrl(raw) {
  const parsed = new URL(raw);
  if (
    parsed.protocol !== "wss:" ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.search ||
    parsed.hash ||
    parsed.pathname !== "/browser/extension" ||
    parsed.href !== raw
  ) {
    throw new Error(
      "Relay URL must be an exact wss:// host ending in /browser/extension with no port, query, fragment, or credentials.",
    );
  }
  return raw;
}

const args = readArgs(process.argv.slice(2));
const relayUrl = validateRelayUrl(args.get("relay-url") ?? "");
const outputDir = path.resolve(args.get("output") ?? "");
const extensionName = args.get("name") ?? "OpenClaw Practical for Arc";

if (!args.get("output") || outputDir === path.parse(outputDir).root) {
  throw new Error("--output must name a non-root directory.");
}
if (!extensionName.trim() || extensionName.length > 75) {
  throw new Error("--name must contain 1–75 characters.");
}

await fs.rm(outputDir, { recursive: true, force: true });
await fs.mkdir(path.join(outputDir, "modules"), { recursive: true });
await fs.cp(path.join(sourceDir, "icons"), path.join(outputDir, "icons"), {
  recursive: true,
});

for (const file of ["background.js", "popup.html", "popup.js"]) {
  await fs.copyFile(path.join(sourceDir, file), path.join(outputDir, file));
}
for (const file of ["cookie-firewall.js", "relay-core.js", "shared-tabs.js"]) {
  await fs.copyFile(path.join(sourceDir, "modules", file), path.join(outputDir, "modules", file));
}

const relayCorePath = path.join(outputDir, "modules", "relay-core.js");
const relayCore = await fs.readFile(relayCorePath, "utf8");
await fs.writeFile(
  relayCorePath,
  relayCore.replaceAll("wss://replace-me.invalid/browser/extension", relayUrl),
);

const manifest = JSON.parse(await fs.readFile(path.join(sourceDir, "manifest.json"), "utf8"));
manifest.name = extensionName;
manifest.action.default_title = extensionName;
await fs.writeFile(path.join(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Built ${extensionName} at ${outputDir}`);
console.log(`Pinned relay: ${relayUrl}`);
