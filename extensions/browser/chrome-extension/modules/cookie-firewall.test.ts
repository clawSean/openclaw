import { describe, expect, it } from "vitest";
import { authorizeCdpCommand, sanitizeCdpEvent, sanitizeCdpResult } from "./cookie-firewall.js";

describe("Arc practical cookie firewall", () => {
  it("blocks direct cookie reads and target expansion", () => {
    expect(() => authorizeCdpCommand("Network.getCookies")).toThrow(/cookie firewall/);
    expect(() => authorizeCdpCommand("Storage.getAllCookies")).toThrow(/cookie firewall/);
    expect(() => authorizeCdpCommand("Target.createTarget")).toThrow(/explicit-tab boundary/);
  });

  it("blocks local and browser-internal navigation", () => {
    for (const url of ["file:///tmp/private", "arc://settings", "chrome://extensions"]) {
      expect(() => authorizeCdpCommand("Page.navigate", { url })).toThrow(/blocked/);
    }
    expect(authorizeCdpCommand("Page.navigate", { url: "https://example.com" })).toEqual({
      method: "Page.navigate",
      params: { url: "https://example.com" },
    });
  });

  it("forces flattened auto-attach", () => {
    expect(
      authorizeCdpCommand("Target.setAutoAttach", { autoAttach: true, flatten: false }),
    ).toEqual({
      method: "Target.setAutoAttach",
      params: { autoAttach: true, flatten: true },
    });
  });

  it("removes cookie and authorization material from protocol traffic", () => {
    const input = {
      headers: { Cookie: "secret", Authorization: "Bearer secret", Accept: "text/html" },
      responseHeaders: [
        { name: "Set-Cookie", value: "session=secret" },
        { name: "Content-Type", value: "text/html" },
      ],
      cookies: [{ name: "session", value: "secret" }],
      headersText: "Set-Cookie: session=secret",
    };
    expect(sanitizeCdpResult("Network.getResponseBody", input)).toEqual({
      headers: { Accept: "text/html" },
      responseHeaders: [{ name: "Content-Type", value: "text/html" }],
      cookies: [],
    });
    expect(sanitizeCdpEvent("Network.responseReceived", input)).toEqual({
      headers: { Accept: "text/html" },
      responseHeaders: [{ name: "Content-Type", value: "text/html" }],
      cookies: [],
    });
    expect(sanitizeCdpEvent("Target.receivedMessageFromTarget", input)).toBeNull();
  });
});
