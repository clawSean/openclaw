# Status

## Current

- Phase: `2.3.0.3` settings-correctness candidate verified locally; packaging,
  publication, and final remote-Mac proof remain.
- Base: OpenClaw `v2026.9.3` at
  `0a7b700f2f6711b99ad91a6cc27caec84f448a22`.
- Branch: `personal/browser-extension-compat-v2026.9.3`.
- Published baseline: `OpenClaw Browser — Sean` `2.3.0.2` at
  [`v2.3.0-arc-dia.2`](https://github.com/clawSean/openclaw-arc-dia-browser-extension/releases/tag/v2.3.0-arc-dia.2).
- Candidate working tree is based on the exact base commit above; its release
  commit is recorded when packaging completes.
- Exact-head extension suite: `635 passed`, `1` upstream opt-in Chromium
  bootstrap test skipped.
- Full production build: passed on Node `24.15.0`.
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
- Live Gateway: exact OpenClaw `2026.9.3` commit `e4b4414` on Node `26.7.0`;
  Gateway RPC, Telegram, iMessage, Nemo, and browser relay passed post-restart
  checks.
- `.2` verification: archive integrity, package/archive parity, SHA-256, and
  filesystem plus Git-history verified-secret scans pass. GitHub CI passed on
  exact release commit `937dc3225dc6`; downloaded assets matched their checksums
  and committed packages. Equivalent `.3` artifact checks remain pending.

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

1. Package, secret-scan, checksum, and publish the `2.3.0.3` prerelease.
2. Load `OpenClaw-Browser-Sean-Arc-Dia-2.3.0.3.zip` on the remote Mac and prove
   truthful live Settings status plus connect/control/disconnect/reconnect.

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
