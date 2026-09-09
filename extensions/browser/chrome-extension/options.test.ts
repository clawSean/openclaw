// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

function status(state: string) {
  return {
    paired: true,
    connectionEnabled: true,
    scopeCleanupPending: false,
    state,
    accessMode: "selected",
    accessibleTabCount: 1,
    nativeBootstrap: { disabled: true, state: "ready", automaticSetupLocked: true },
  };
}

describe("browser extension options live status", () => {
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it("stays live past relay backoff and fails closed on resolved status errors", async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    document.body.innerHTML = `
      <div id="pairingStatus"></div>
      <div id="connectionStatus"></div>
      <div id="accessStatus"></div>
      <div id="bootstrapStatus"></div>
      <input id="automaticSetup" type="checkbox" />
      <select id="accessMode"><option value="selected">Selected</option></select>
      <textarea id="pairingString"></textarea>
      <button id="pair"></button>
      <button id="useLocal"></button>
      <button id="connectionAction"></button>
      <button id="disconnect"></button>
      <div id="message"></div>
      <div id="retiredCustody" class="hidden"></div>
    `;

    let currentStatus: ReturnType<typeof status> | { ok: false; error: string } =
      status("connecting");
    let pairResult: { ok: boolean; error?: string } = { ok: true };
    const sendMessage = vi.fn(async (request: { type?: string }) =>
      request.type === "getStatus" ? currentStatus : pairResult,
    );
    vi.stubGlobal("chrome", { runtime: { sendMessage } });

    vi.resetModules();
    await import("./options.js");
    await vi.advanceTimersByTimeAsync(0);
    expect(document.getElementById("connectionStatus")?.textContent).toBe("Connecting to Sean…");

    await vi.advanceTimersByTimeAsync(13_000);
    expect(document.getElementById("connectionStatus")?.textContent).toBe("Connecting to Sean…");
    currentStatus = status("on");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(document.getElementById("connectionStatus")?.textContent).toBe("Connected to Sean");

    currentStatus = { ok: false, error: "Could not read live status." };
    window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(0);
    expect(document.getElementById("pairingStatus")?.textContent).toBe("Unknown");
    expect(document.getElementById("connectionStatus")?.textContent).toBe("Status unavailable");
    expect(document.getElementById("pair")?.hasAttribute("disabled")).toBe(true);

    currentStatus = status("error");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(document.getElementById("connectionStatus")?.textContent).toBe("Unavailable");
    expect(document.getElementById("accessStatus")?.textContent).toBe("1 tab selected for Sean");
    expect(document.getElementById("pair")?.hasAttribute("disabled")).toBe(false);
    expect(document.getElementById("bootstrapStatus")?.textContent).toBe(
      "Manual pairing active; forget pairing before local setup",
    );
    expect(document.getElementById("automaticSetup")?.hasAttribute("disabled")).toBe(true);
    expect(document.getElementById("useLocal")?.hasAttribute("disabled")).toBe(true);

    const pairingInput = document.getElementById("pairingString") as HTMLTextAreaElement;
    const pairButton = document.getElementById("pair") as HTMLButtonElement;
    pairingInput.value = "synthetic pairing material";
    pairButton.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(pairingInput.value).toBe("");

    pairResult = { ok: false, error: "Pairing rejected." };
    pairingInput.value = "retain rejected material";
    pairButton.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(pairingInput.value).toBe("retain rejected material");
    expect(document.getElementById("message")?.textContent).toBe("Pairing rejected.");
  });
});
