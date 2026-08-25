import { describe, expect, it } from "vitest";
import {
  PINNED_RELAY_URL,
  buildRelayWsProtocols,
  parsePairingString,
  reconnectDelayMs,
  toRelayTabInfo,
} from "./relay-core.js";

const token = "a".repeat(64);

describe("Arc practical relay pairing", () => {
  it("accepts only the build-time pinned relay", () => {
    expect(parsePairingString(`${PINNED_RELAY_URL}#${token}`)).toEqual({
      relayUrl: PINNED_RELAY_URL,
      token,
    });
    expect(parsePairingString(`wss://other.invalid/browser/extension#${token}`)).toBeNull();
    expect(parsePairingString(`ws://replace-me.invalid/browser/extension#${token}`)).toBeNull();
    expect(parsePairingString(`${PINNED_RELAY_URL}?redirect=1#${token}`)).toBeNull();
    expect(parsePairingString(`${PINNED_RELAY_URL}#bad token`)).toBeNull();
  });

  it("keeps the relay credential out of the URL", () => {
    expect(buildRelayWsProtocols(token)).toEqual([
      "openclaw-extension-relay",
      `openclaw-extension-token.${token}`,
    ]);
  });

  it("bounds reconnect backoff", () => {
    expect(reconnectDelayMs(0)).toBe(1000);
    expect(reconnectDelayMs(4)).toBe(16_000);
    expect(reconnectDelayMs(50)).toBe(30_000);
  });

  it("normalizes only relay-visible tab metadata", () => {
    expect(
      toRelayTabInfo({ id: 7, url: "https://example.com", title: "Example", active: true }),
    ).toEqual({
      tabId: 7,
      url: "https://example.com",
      title: "Example",
      active: true,
    });
  });
});
