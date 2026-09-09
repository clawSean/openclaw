# Status

## Current

- Phase: published; host rollout remains approval-gated.
- Base: OpenClaw `v2026.9.3` at
  `1391f7cd2d40ab5bbcf2f5f831d3a64f520e72d7`.
- Branch: `personal/browser-extension-compat-v2026.9.3`.
- Released: `OpenClaw Browser — Sean` `2.3.0.1` at
  [`v2.3.0-arc-dia.1`](https://github.com/clawSean/openclaw-arc-dia-browser-extension/releases/tag/v2.3.0-arc-dia.1).
- Artifact source commit: `8f7aa9b3c933c58ae054665e721ca1c4e85f8029`.
- Exact-head extension suite: `611 passed`, `1` upstream opt-in Chromium
  bootstrap test skipped.
- Full production build: passed on Node `26.7.0`.
- Real disposable-profile proof: Arc `1.163.0` and Dia `1.47.1` both passed
  direct Gateway pairing, inventory, semantic snapshot, typing, single-tab
  handoff, zero-tab disconnect, and reconnect without re-pairing. Arc also
  passed select and click; Dia passed direct navigation.
- Live installation: unchanged on `2026.9.1`. The `2026.9.3` proof Gateway was
  isolated on port `19931`; no live Gateway, personal browser profile, or global
  OpenClaw package was changed.
- Release verification: public CI passed; final filesystem and Git-history
  secret scans reported zero verified secrets; downloaded release assets
  matched the committed packages and SHA-256 checksums.

## Decisions

- Publish untouched upstream `2.3.0` separately from the clearly named Sean
  build. The Sean build contains the requested access controls and narrow
  credential/cookie defenses.
- Keep primary automation intact. The custom controls change tab consent and
  connection custody only; they do not add navigation or interaction friction.
- Keep all endpoint and pairing material outside source and evidence.
- Do not edit the global npm package. Any dependency install, live activation,
  or Gateway restart retains its explicit approval gate.
- Use session-scoped tab IDs after the first explicit Share action. Browser exit
  clears tab grants while preserving pairing, which fails closed without making
  JPop paste the pairing code again.

## Next

1. Complete final secret/history scans.
2. Package upstream `2.3.0` and `OpenClaw Browser — Sean` `2.3.0.1` with clean,
   unmistakable filenames and SHA-256 checksums.
3. Publish and download-verify the GitHub release.
4. Separately request approval before any live `2026.9.3` runtime-path change or
   Gateway restart.

## Known risks

- Arc hangs on `chrome.tabGroups.query`; the Sean build's explicit single-tab
  registry avoids that API, and the compatibility probe now times out that
  diagnostic query independently. Untouched upstream selected-tab mode is
  therefore not the recommended Arc path.
- Automatic native-host setup is Chrome-oriented. Manual direct-Gateway pairing
  remains the dependable Arc/Dia path, including over a valid Tailscale WSS URL.
- The live `2026.9.1` Gateway still contains the old target-identity failure.
  Using this release's full browser-control path requires an approved live update
  to `2026.9.3` or newer.
- Screenshot and one below-fold Dia click could not be meaningfully proven in
  the no-display macOS session. This is recorded as a window-geometry limitation;
  semantic snapshots, typing, Arc click/select, and Dia navigation passed.
