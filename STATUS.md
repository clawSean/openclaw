# Status

## Current

- Phase: `2.3.0.3` is packaged and published as a prerelease. Automated and
  Settings-page checks pass; final manual-WSS control proof is blocked by a
  stale live Gateway process loading an obsolete generated `dist` chunk.
- Upstream base: OpenClaw `v2026.9.3` at
  `1391f7cd2d40ab5bbcf2f5f831d3a64f520e72d7`.
- Branch: `personal/browser-extension-compat-v2026.9.3`.
- Source commit: `276d71266bcf588225d23713deddddec5d53b6d5`.
- Published candidate: `OpenClaw Browser — Sean` `2.3.0.3` at
  [`v2.3.0-arc-dia.3`](https://github.com/clawSean/openclaw-arc-dia-browser-extension/releases/tag/v2.3.0-arc-dia.3),
  release commit `bed338e97d88ae373209bb94c1a6e9b32d8cfb1e`.
- Exact-head extension suite: `635 passed`, `1` upstream opt-in Chromium
  bootstrap test skipped.
- Full production build: passed on supported Node `26.7.0`.
- Real disposable-profile proof: Arc `1.163.0` and Dia `1.47.1` both passed
  direct Gateway pairing, inventory, semantic snapshot, typing, single-tab
  handoff, zero-tab disconnect, and reconnect without re-pairing. Arc also
  passed select and click; Dia passed direct navigation.
- The `.2` release fixes the real remote-Arc handoff failures found after the
  `.1` release: current-tab identity authorization, live popup reconnect status,
  and bounded Arc replacement-tab adoption.
- The `.3` candidate fixes the false Settings status: Pairing, Relay, and Access
  are separate live facts; Settings refreshes while visible, never calls a
  side-effecting bootstrap retry, clears submitted pairing text, and fails
  controls closed when status cannot be read. Explicit native/manual provenance
  prevents automatic setup from overriding a manual Gateway pairing without
  misclassifying a native local pairing. Cancellation races are fenced.
- Fresh disposable Dia `1.47.1` proof loaded exact `2.3.0.3` bytes: the real
  unpaired Settings page rendered `Not paired`, `Not configured`, and `No
browser access`; page-local live-state inputs changed Connecting to Connected
  in about one second and held Unavailable across later polls with zero false
  Connected claims. The proof used no Gateway, pairing secret, or live config.
- A later disposable Dia manual-WSS attempt verified the exact published `.3`
  asset, disabled automatic local setup, and reached the active Tailscale
  `/browser/extension` route. It correctly rendered `Connecting` then
  `Unavailable` because the running Gateway process imports missing generated
  chunk `gateway-relay-route-ZWmPGjrq.mjs`; the current coherent `dist` instead
  references `gateway-relay-route-C05o6QSx.mjs`. Gateway logs record
  `ERR_MODULE_NOT_FOUND`, and the route returns `502` before authentication.
  This is a deployment blocker, not an extension pass or credential failure.
- Live Gateway: OpenClaw `2026.9.3` on Node `26.7.0`; Gateway RPC, Telegram,
  and iMessage remain healthy. Browser relay upgrades remain blocked until the
  already-built coherent `dist` is activated by an explicitly approved restart.
- `.3` verification: archive integrity, package/archive parity, SHA-256, and
  filesystem plus Git-history verified-secret scans pass. GitHub artifact CI
  passed on exact release commit `bed338e97d88`; downloaded assets matched their
  checksums and committed packages. Reproducible CI now pins source commit
  `276d71266bc` and upstream commit `1391f7cd2d4`, rebuilds both packages, and
  compares them byte-for-byte with the committed artifacts.

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
- Persist pairing provenance instead of guessing authority from URL shape.
  Legacy direct-remote pairings migrate to manual authority; legacy loopback
  Gateway pairings preserve automatic authority and its independent opt-out.

## Next

1. Obtain explicit approval to restart the Gateway once into the already-built,
   coherent current `dist`; capture rollback state and use the watchdog path.
2. Re-run exact public `.3` manual-WSS proof: pair, publish one tab, snapshot and
   act, disconnect to zero, reconnect without a code, then clean up.
3. If green, promote the immutable `.3` release to Latest and update the private
   Clawdia handoff from prerelease to final.

## Known risks

- Arc hangs on `chrome.tabGroups.query`; the Sean build's explicit single-tab
  registry avoids that API, and the compatibility probe now times out that
  diagnostic query independently. Untouched upstream selected-tab mode is
  therefore not the recommended Arc path.
- Automatic native-host setup is Chrome-oriented. Manual direct-Gateway pairing
  remains the dependable Arc/Dia path, including over a valid Tailscale WSS URL.
- The `.1` artifact is superseded by `.2`; its real remote-Arc one-tab handoff can
  reconnect with zero published tabs. `.2` is superseded once `.3` publishes.
- Arc `1.163.0` ignored the disposable `--user-data-dir` during the `.3` Settings
  proof attempt and opened the personal profile. Testing stopped immediately;
  no `.3` Arc UI result is claimed until a safely isolated or remote proof exists.
- Screenshot and one below-fold Dia click could not be meaningfully proven in
  the no-display macOS session. This is recorded as a window-geometry limitation;
  semantic snapshots, typing, Arc click/select, and Dia navigation passed.
