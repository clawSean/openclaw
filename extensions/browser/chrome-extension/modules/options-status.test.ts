import { describe, expect, it } from "vitest";
import { accessStatusText, pairingStatusText, relayStatusText } from "./options-status.js";

describe("browser extension options status", () => {
  it("shows pairing, relay, and selected-tab access as separate facts", () => {
    const status = {
      paired: true,
      connectionEnabled: true,
      state: "on",
      accessMode: "selected",
      accessibleTabCount: 1,
    };

    expect(pairingStatusText(status)).toBe("Saved");
    expect(relayStatusText(status)).toBe("Connected to Sean");
    expect(accessStatusText(status)).toBe("1 tab selected for Sean");
  });

  it("does not describe a locally selected tab as a live relay connection", () => {
    const status = {
      paired: true,
      connectionEnabled: true,
      state: "error",
      accessMode: "selected",
      accessibleTabCount: 1,
    };

    expect(pairingStatusText(status)).toBe("Saved");
    expect(relayStatusText(status)).toBe("Unavailable");
    expect(accessStatusText(status)).toBe("1 tab selected for Sean");
  });

  it("does not erase persisted selected-tab intent while access is paused", () => {
    expect(
      accessStatusText({
        paired: true,
        connectionEnabled: false,
        state: "off",
        accessMode: "selected",
        accessibleTabCount: 0,
      }),
    ).toBe("Access paused; selected-tab mode kept");
  });

  it("does not claim saved tab access after unpair or during recovery", () => {
    expect(
      accessStatusText({
        paired: false,
        connectionEnabled: false,
        accessMode: "selected",
        accessibleTabCount: 0,
      }),
    ).toBe("No browser access");
    expect(
      accessStatusText({
        paired: true,
        connectionEnabled: false,
        accessMode: "selected",
        accessibleTabCount: 1,
        retiredCopilotCustodyBlocked: true,
      }),
    ).toBe("Automation paused for recovery");
    expect(
      accessStatusText({
        paired: true,
        connectionEnabled: false,
        accessMode: "selected",
        accessibleTabCount: 1,
        scopeCleanupPending: true,
      }),
    ).toBe("Access paused during tab handoff");
  });
});
