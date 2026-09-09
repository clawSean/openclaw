# Browser compatibility evidence

Candidate baseline: OpenClaw `v2026.9.3`, personalized extension `2.3.0.3`.

The September 8 `2.3.0.1` proof used disposable Arc and Dia profiles, the exact
production build, and an isolated `2026.9.3` Gateway. Pairing targeted the direct
`/browser/extension` Gateway route used by remote Tailscale deployments. Pairing
material stayed in temporary files and is excluded from source and receipts.

| Capability                   |                 Arc |                 Dia | Evidence                                                                                                                  |
| ---------------------------- | ------------------: | ------------------: | ------------------------------------------------------------------------------------------------------------------------- |
| Load personalized MV3 worker |                pass |                pass | exact `2.3.0.1` production output                                                                                         |
| Direct Gateway pairing       |                pass |                pass | authenticated relay-v2 route                                                                                              |
| Publish existing tab         |                pass |                pass | extension and Gateway inventories agree                                                                                   |
| Semantic snapshot            |                pass |                pass | real public Selenium fixture                                                                                              |
| Type                         |                pass |                pass | action completed on fixture textbox                                                                                       |
| Select / click               |                pass | environment-limited | Arc passed; Dia's below-fold click lacked display geometry                                                                |
| Direct navigation            |                pass |                pass | selected tab retained identity across navigation                                                                          |
| Two tabs → one intended tab  |                pass |                pass | other tab removed from Gateway inventory                                                                                  |
| Full disconnect              |                pass |                pass | Gateway inventory became zero; pairing remained saved                                                                     |
| Reconnect without code       |                pass |                pass | exactly the selected tab returned                                                                                         |
| Credential firewall          |           unit pass |           unit pass | cookie/auth, CacheStorage headers, nested CDP tunnels, and cross-tab Target attachment blocked; ordinary page JS retained |
| Screenshot                   | environment-limited | environment-limited | no capturable desktop geometry in proof session                                                                           |
| Native bootstrap             |            not used |            not used | manual pairing is the cross-browser path                                                                                  |

## Compatibility conclusion

Primary Arc and Dia functionality was satisfied by the `2.3.0.1` baseline on
exact OpenClaw `2026.9.3`.
The Sean build avoids Arc's hanging `chrome.tabGroups.query` path by using an
explicit session-backed tab registry after the first Share action. **Share only
this tab with Sean** atomically replaces the prior grant set. **Disconnect Sean
(keep pairing)** publishes an empty inventory and detaches active sessions;
**Reconnect Sean** restores the saved one-tab scope without another pairing code.

The live Gateway now runs exact OpenClaw `2026.9.3`. Release `2.3.0.2` fixes the
handoff failures found on the first real remote Arc install. Candidate `2.3.0.3`
adds truthful, live Settings status and explicit pairing authority; its exact
extension suite passes 635 tests with one upstream opt-in Chromium bootstrap
test skipped. Exact remote-Mac confirmation is still required before final
promotion. Screenshot and one Dia click remain unclaimed because the proof host
had no usable window geometry; they do not block the proven semantic and
navigation control path.

## Settings-status evidence for 2.3.0.3

- Pairing, authenticated Relay, and browser Access render as separate facts.
- Visible Settings refreshes every second and reflects connecting, connected,
  disconnected, and unavailable states without reopening the page.
- Status reads are side-effect free; startup, the 30-second watchdog, and an
  explicit **Use local OpenClaw** action own native bootstrap attempts.
- Manual Gateway pairing disables automatic local setup until the pairing is
  forgotten. Native local pairing remains automatic because its provenance is
  stored rather than inferred from the shared `/browser/extension` URL shape.
- A successful manual pair clears the credential-bearing textarea; rejected
  input stays available for correction. Status failures disable controls.
- Fresh disposable Dia `1.47.1` proof loaded the exact final `2.3.0.3` files.
  The real unpaired page rendered `Not paired`, `Not configured`, and `No
browser access`. Isolated page-local status inputs then reached Connected in
  `1002.4 ms`, held Unavailable through two later polls with zero false
  Connected claims, and kept automatic setup controls inert while manual
  pairing was locked.
- Arc UI proof is intentionally unclaimed because Arc ignored its disposable
  profile flag and opened the personal profile; testing stopped immediately.
