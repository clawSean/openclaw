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
- Ported upstream runtime fixes `d52acf702b4` and `fe784239d80` for persistent
  tab-enumeration budgets, cancellation, standalone routing, and screenshot
  ownership. Focused browser proof: 293 tests passed, 3 Chromium-only tests
  skipped because the matching Playwright browser binary is absent.
- Published secret-free standalone distribution at
  `https://github.com/clawSean/openclaw-arc-dia-browser-extension`.
- Published release `v2.2.0-arc-dia.1` with native-faithful and personal-hardened
  ZIPs plus SHA-256 checksums. Downloaded all release assets back from GitHub and
  verified both checksums.
- TruffleHog found zero verified secrets in the public filesystem and complete
  Git history. GitHub Actions artifact validation passed at run `33694333755`.
- After the first approved runtime activation, fresh Dia proof reproduced a
  second post-release Gateway defect: cancellation cleanup after one successful
  action disconnected the shared Playwright session, so the next existing-tab
  action fell through to forbidden `Target.createTarget` behavior.
- Ported upstream `a4b24a878ff` byte-exact as `244bcd2255c` to isolate native
  action cancellation by page. Focused result: 126 passed, 8 opt-in Chromium
  tests skipped; full production build passed.
- Bounded the CDP compatibility probe so a nonresponsive extension options page
  fails after five seconds instead of stranding the test harness.
