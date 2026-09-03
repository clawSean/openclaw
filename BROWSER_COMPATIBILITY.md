# Browser compatibility evidence

Baseline: OpenClaw `v2026.8.2`, extension `2.2.0`.

| Capability                    |         Arc 1.161.0 |          Dia 1.46.0 | Result                        |
| ----------------------------- | ------------------: | ------------------: | ----------------------------- |
| Load unpacked MV3 worker      |                pass |                pass | native                        |
| Required Chrome APIs          |                pass |                pass | no shim needed                |
| `tabGroups.query`             |                pass |                pass | no Arc/Dia API gap            |
| Manual relay pairing          |                pass |                pass | preferred cross-browser setup |
| Tailscale WSS relay           |                pass |                pass | authenticated v2 transport    |
| Publish existing tab          |                pass |                pass | all-tabs mode                 |
| Semantic snapshot             |        intermittent |        intermittent | Gateway identity race remains |
| Interactive Playwright action |     gateway failure |     gateway failure | not an extension API failure  |
| Screenshot                    | environment-blocked | environment-blocked | no capturable macOS screen    |
| Native bootstrap              |   host unregistered |   host unregistered | Chrome-only installer roots   |

## Compatibility conclusion

Arc and Dia need no browser-specific API shim. The extension-side compatibility
repair is the upstream stale-group lifecycle fix. Remote pairing over Tailscale
is the stable setup path because the native-host installer does not own either
browser's native-messaging manifest directory.

The remaining snapshot/action defect lives in OpenClaw's persistent Playwright
session/target enumeration. The final patched-runtime proof still reproduced it:
the relay listed the real Dia tab, but Playwright could not resolve that page's
target identity and then attempted forbidden remote tab creation. It must be
repaired in the Gateway runtime; changing the extension to mask it would violate
the native-faithful deliverable's contract.
