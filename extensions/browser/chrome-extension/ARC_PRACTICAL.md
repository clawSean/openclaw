# OpenClaw Practical for Arc

This branch carries an Arc-compatible derivative of OpenClaw's Chrome extension
from upstream commit `2d2ddc43d0d`. It keeps normal Playwright/CDP page control
while replacing Chrome tab-group consent with explicit per-tab sharing.

Additional boundaries:

- starts with zero shared tabs and denies remote tab creation;
- pins one exact `wss://.../browser/extension` relay at build time;
- rejects file, browser-internal, extension, and private-window access;
- blocks direct CDP cookie-jar reads and strips cookie/auth headers from CDP
  protocol results and events;
- clears shared-tab consent when Arc exits or the extension is unpaired.

This is risk reduction, not a zero-secret broker. Page JavaScript remains
available, so an explicitly shared page can still expose non-HttpOnly cookies,
web storage, filled fields, and other page-readable data.

## Build

From the repository root:

```sh
node extensions/browser/scripts/build-arc-practical.mjs \
  --relay-url wss://your-gateway.example/browser/extension \
  --name "OpenClaw Practical for Arc — My Agent" \
  --output /absolute/path/to/openclaw-arc-extension
```

Load the output directory through Arc's extensions page with Developer mode
enabled. Keep file-URL and private-window access disabled. Generate the pairing
string on the Gateway with:

```sh
openclaw browser extension pair --gateway-url wss://your-gateway.example
```

The reverse proxy must preserve `/browser/extension` when forwarding to the
Gateway. A path-stripping proxy falls through to the main Gateway WebSocket and
the extension will briefly connect, then disconnect.

## Lineage and license

The branch is published inside `clawSean/openclaw`, GitHub's recognized fork of
`openclaw/openclaw`. The upstream source and this derivative are MIT-licensed;
see the repository root `LICENSE` and `THIRD_PARTY_NOTICES.md`.
