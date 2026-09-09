# Browser compatibility evidence

Candidate baseline: OpenClaw `v2026.9.3`, personalized extension `2.3.0.1`.

The final September 8 proof used disposable Arc and Dia profiles, the exact
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

Primary Arc and Dia functionality is satisfied on exact OpenClaw `2026.9.3`.
The Sean build avoids Arc's hanging `chrome.tabGroups.query` path by using an
explicit session-backed tab registry after the first Share action. **Share only
this tab with Sean** atomically replaces the prior grant set. **Disconnect Sean
(keep pairing)** publishes an empty inventory and detaches active sessions;
**Reconnect Sean** restores the saved one-tab scope without another pairing code.

The remaining blocker is deployment, not extension behavior: the live Gateway
is still `2026.9.1` and needs separate approval to update/restart. Screenshot and
one Dia click remain unclaimed because the proof host had no usable window
geometry; they do not block the proven semantic and navigation control path.
