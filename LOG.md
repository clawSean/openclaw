# Log

## 2026-09-09

- Activated and post-restart verified the exact OpenClaw `2026.9.3` Gateway on
  Node `26.7.0`; Gateway RPC, Telegram, iMessage, Nemo, and browser relay passed.
- A real remote Arc install of `2.3.0.1` paired over Tailscale but exposed three
  handoff defects: stale popup status, a short Arc replacement-tab visibility
  gap, and the credential firewall blocking Playwright's session-scoped
  `Target.getTargetInfo` query.
- Fixed those defects in source commit
  `32743d4473f4d3cda5ac8bebdf72ad519851779c`. Explicit cross-target queries and
  credential/cookie extraction remain blocked.
- Exact-head extension tests passed `613/613` with one opt-in upstream Chromium
  bootstrap skip. The `2.3.0.2` ZIP passed archive/package parity, SHA-256, and
  verified-secret scans and was sent privately for exact remote-Mac proof.
- Public `.2` release is intentionally pending until the remote Mac proves the
  corrected share/disconnect/reconnect flow.

## 2026-09-08

- Installed the exact lockfile dependencies in the isolated `v2026.9.3`
  worktree with the already-installed Node `26.7.0`; the live runtime remained
  untouched.
- Added the clearly branded `OpenClaw Browser — Sean` `2.3.0.1` derivative.
  Its popup exposes **Share only this tab with Sean**, **Disconnect Sean (keep
  pairing)**, and **Reconnect Sean**.
- Replaced the Arc-incompatible explicit-selection path with a session-backed
  tab registry. The first explicit Share action enables the registry; untouched
  upstream behavior remains the fallback until then. Browser restart clears tab
  grants but preserves the pairing configuration.
- Added fail-closed handling for interrupted scope handoff, registry read/write
  failure, target-creation races, closed tabs, and Chromium tab replacement.
- Extended the credential firewall to sanitize CacheStorage request/response
  headers as well as Network, Fetch, Storage, and Audits protocol payloads. It
  also blocks nested CDP tunnels and physical Target enumeration or attachment
  that could escape the selected-tab ledger. Only the flattened relay lifecycle
  commands remain available.
- Added a narrow credential firewall that blocks direct cookie-jar and raw
  cookie/auth CDP extraction while preserving normal page automation.
- Exact-head extension suite passed: `611 passed`, `1` upstream opt-in Chromium
  bootstrap test skipped. The full production build passed on Node `26.7.0`.
- Independent review found no remaining production blocker. It also caught and
  fixed a removal-order regression plus an Arc-only diagnostic query that could
  hang the proof harness without affecting extension runtime behavior.
- Ran the personalized production extension against an isolated exact-head
  Gateway through the direct `/browser/extension` route. Arc `1.163.0` passed
  inventory, snapshot, type, select, click, two-to-one tab handoff, disconnect
  to zero tabs, and reconnect without re-pairing.
- Ran the equivalent Dia `1.47.1` proof. Inventory, snapshot, type, direct
  navigation, two-to-one tab handoff, disconnect to zero tabs, and reconnect
  without re-pairing passed.
- Arc's `chrome.tabGroups.query` remains unusable. The new Share-only flow does
  not call it. A no-display macOS session prevented meaningful screenshot proof
  and one below-fold Dia click; those are recorded as geometry limitations, not
  extension passes.
- Published source commit `8f7aa9b3c933c58ae054665e721ca1c4e85f8029`
  and release `v2.3.0-arc-dia.1`. Public CI, complete-history and filesystem
  secret scans, archive/package parity, SHA-256 checksums, and downloaded asset
  byte comparisons all passed.
- All proof profiles, pairings, and Gateway state are disposable. The live
  `2026.9.1` Gateway and personal Arc/Dia profiles were not changed.

- Confirmed the live runtime remains the isolated `2026.9.1` compatibility
  checkout; no live files, config, extension profile, or Gateway process changed.
- Verified OpenClaw `v2026.9.3` is the newest stable release and resolves to
  `1391f7cd2d40ab5bbcf2f5f831d3a64f520e72d7`.
- Created `personal/browser-extension-compat-v2026.9.3` in a new worktree and
  replayed only the reusable Arc/Dia harness changes from the prior project.
- Confirmed the shipped extension is now `2.3.0`. Its production extension
  delta from `2026.9.1` is only the manifest version; the runtime browser stack
  changed substantially.
- Identified upstream `db089527c8b` in `2026.9.3` as the owner-correct repair
  for the prior missing-target/attachment-loss failure. It must still pass the
  real Arc and Dia topology before the project can claim success.
- Passed JavaScript syntax checks for every replayed harness script and
  `git diff --check`. Exact-head dependency-backed tests await approval for a
  frozen lockfile install in the isolated worktree.
- Confirmed the currently installed browsers are Arc `1.163.0` and Dia `1.47.1`.
- Confirmed the official Chrome Web Store listing is now OpenClaw `2.3.0`, so
  the preferred native-faithful route is Store-first if repeated Arc proof
  passes; the custom hardened derivative remains a separate artifact.
- Hardened commit `d9bd0525cb3` applies cleanly to the `2026.9.3` extension
  sources in a three-way check. It remains unlanded until native proof is green.
- Replaced suffix-only worker discovery in `extension-status.mjs` with manifest
  identity verification so Dia built-in workers cannot produce false results.
- Ran a disposable Arc `1.163.0` pre-activation probe with the exact upstream
  `2.3.0` extension against the current `2026.9.1` Gateway. The extension loaded,
  paired over Tailscale, exposed one fixture tab, and Gateway inventoried the
  same tab. Snapshot then reproduced the old target-creation fallthrough. The
  disposable profile was cleaned successfully; this is extension compatibility
  evidence, not a `2026.9.3` runtime pass.
- Ran the equivalent Dia `1.47.1` pre-activation probe. Explicitly creating the
  fixture through Dia's disposable CDP endpoint produced one extension-accessible
  tab and one Gateway tab, eliminating the former zero-tab harness artifact.
  Snapshot reached the same old-runtime identity fallthrough and cleanup passed.

## 2026-09-02

- Created a clean worktree from the exact installed release tag `v2026.8.2`.
- Preserved the older `v2026.7.1` Arc practical branch as a read-only reference.
- Confirmed the shipped extension source is Manifest V3, version `2.2.0`, with
  debugger, tabs, tabGroups, storage, alarms, and nativeMessaging permissions.
- Confirmed the runtime bundle includes native bootstrap and standalone relay
  wake-up support.
- Created disposable Arc and Dia profiles and loaded the source extension into
  those profiles only. JPop's normal browser profiles remain untouched.
- Confirmed Arc `1.161.0` (Chromium 151) and Dia `1.46.0` (Chromium 152) expose
  debugger, tabs, tabGroups, storage, alarms, and nativeMessaging APIs.
- Confirmed manual v2 pairing and authenticated relay transport over the existing
  Tailscale HTTPS/WSS route. No pairing or relay credential is stored in source.
- Confirmed both browsers publish an externally opened tab and support semantic
  snapshots through the installed Gateway.
- Reproduced stale Playwright target/page failures during interactive actions in
  both browsers. The browser tabs remain alive and raw CDP remains reachable,
  isolating this from the extension's native debugger attachment.
- Ported upstream commit `9d10dcb5d39` which prevents stale tab-group updates
  from revoking commands admitted after a newer tab event.
- Extension suite: 18 files passed, 1 skipped; 539 tests passed, 1 skipped.
- Full production build passed. Opt-in Chromium E2E is presently blocked because
  the matching Playwright Chromium binary is not installed; no browser binary was
  downloaded merely to satisfy that duplicate harness.
- No Gateway restart, global extension install, or normal browser-profile change
  has occurred.
