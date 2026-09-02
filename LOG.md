# Log

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
