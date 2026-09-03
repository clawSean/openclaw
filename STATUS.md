# Status

## Current

- Phase: approved runtime activation and final live E2E proof
- Base: OpenClaw `v2026.8.2` at `0965053fe6b9341776df147a6934b7485c60b5ca`
- Branch: `personal/browser-extension-compat-v2026.8.2`
- Previous reference: `/Users/Sean/projects/openclaw-arc-extension`
- Live installation: compatibility worktree active through the OpenClaw CLI
  symlink; tests use disposable Arc/Dia profiles
- Proof state: source, artifacts, secret scans, GitHub readback, and CI green;
  final live proof found an unresolved persistent-Playwright target-identity defect

## Decisions

- Preserve upstream behavior in the first deliverable; browser-specific changes
  must be compatibility adapters, not new product policy.
- Implement critical credential/cookie defenses only in the second deliverable.
- Keep all endpoint and pairing material outside source and evidence.
- Do not edit the global npm package. Gateway restarts for this campaign were
  explicitly approved and must use the deterministic watchdog.

## Next

1. Repair the target-identity handoff between relay inventory and Playwright
   without allowing implicit remote tab creation.
2. Repeat the Arc/Dia interaction matrix against that runtime.
3. Record screenshot proof as environment-blocked unless a capturable NSScreen
   becomes available; do not treat that host limitation as browser failure.
4. Record final live results and close the project.

## Known risks

- Arc and Dia both expose every required extension API, including `tabGroups`.
- Automatic native-host discovery does not register Arc or Dia, so remote pairing
  is the dependable cross-browser path.
- The original `2026.8.2` Gateway intermittently loses Playwright target identity,
  and the three matching post-release fixes tested on 2026-09-02 do not fully
  repair first-snapshot identity resolution in the Tailscale relay topology:
  Arc reports `Remote tab creation is disabled` during an existing-tab action;
  Dia reports `Page closed before browser action completed`. Direct tab discovery
  and snapshots remain healthy. This is below the extension and must be kept out
  of the extension compatibility patch.
- Fast watchdog rollback returns to the untouched global `2026.8.2` package and
  therefore drops every post-release browser runtime fix. The applied runtime is
  identified by buildstamp SHA, not by the shared `2026.8.2` version string.
- Screenshots cannot be visually proved in the current automation account because
  macOS exposes no capturable `NSScreen`; semantic snapshots are proven instead.
