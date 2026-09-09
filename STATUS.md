# Status

## Current

- Phase: `2.3.0.2` prerelease published; final remote-Mac proof and promotion
  remain.
- Base: OpenClaw `v2026.9.3` at
  `1391f7cd2d40ab5bbcf2f5f831d3a64f520e72d7`.
- Branch: `personal/browser-extension-compat-v2026.9.3`.
- Published baseline: `OpenClaw Browser — Sean` `2.3.0.1` at
  [`v2.3.0-arc-dia.1`](https://github.com/clawSean/openclaw-arc-dia-browser-extension/releases/tag/v2.3.0-arc-dia.1).
- Candidate source commit: `32743d4473f4d3cda5ac8bebdf72ad519851779c`.
- Exact-head extension suite: `613 passed`, `1` upstream opt-in Chromium
  bootstrap test skipped.
- Full production build: passed on Node `26.7.0`.
- Real disposable-profile proof: Arc `1.163.0` and Dia `1.47.1` both passed
  direct Gateway pairing, inventory, semantic snapshot, typing, single-tab
  handoff, zero-tab disconnect, and reconnect without re-pairing. Arc also
  passed select and click; Dia passed direct navigation.
- The `.2` candidate fixes the real remote-Arc handoff failures found after the
  `.1` release: current-tab identity authorization, live popup reconnect status,
  and bounded Arc replacement-tab adoption. Focused regressions and the full
  extension suite pass; exact remote-Mac confirmation is still required.
- Live Gateway: exact OpenClaw `2026.9.3` commit `e4b4414` on Node `26.7.0`;
  Gateway RPC, Telegram, iMessage, Nemo, and browser relay passed post-restart
  checks.
- Candidate verification: archive integrity, package/archive parity, SHA-256,
  and filesystem plus Git-history verified-secret scans pass. GitHub CI passed
  on exact release commit `937dc3225dc6`; the prerelease assets were downloaded
  back and matched their checksums and committed packages.

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

1. Load `OpenClaw-Browser-Sean-Arc-Dia-2.3.0.2.zip` on the remote Mac.
2. Prove connect, one-tab share, snapshot/control, disconnect to zero, and
   reconnect without re-pairing.
3. Promote the existing `v2.3.0-arc-dia.2` prerelease to final without changing
   its verified assets.

## Known risks

- Arc hangs on `chrome.tabGroups.query`; the Sean build's explicit single-tab
  registry avoids that API, and the compatibility probe now times out that
  diagnostic query independently. Untouched upstream selected-tab mode is
  therefore not the recommended Arc path.
- Automatic native-host setup is Chrome-oriented. Manual direct-Gateway pairing
  remains the dependable Arc/Dia path, including over a valid Tailscale WSS URL.
- The `.1` artifact is superseded by `.2`; its real remote-Arc one-tab handoff can
  reconnect with zero published tabs.
- Screenshot and one below-fold Dia click could not be meaningfully proven in
  the no-display macOS session. This is recorded as a window-geometry limitation;
  semantic snapshots, typing, Arc click/select, and Dia navigation passed.
