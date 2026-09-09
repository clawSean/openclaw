import { describe, expect, it } from "vitest";
import { authorizeCdpCommand, sanitizeCdpEvent, sanitizeCdpResult } from "./credential-firewall.js";

describe("personal credential firewall", () => {
  it("blocks direct cookie reads but leaves ordinary CDP commands unchanged", () => {
    expect(() => authorizeCdpCommand("Network.getCookies")).toThrow(/credential firewall/);
    expect(() => authorizeCdpCommand("Storage.getAllCookies")).toThrow(/credential firewall/);
    expect(authorizeCdpCommand("Runtime.evaluate", { expression: "document.title" })).toEqual({
      method: "Runtime.evaluate",
      params: { expression: "document.title" },
    });
  });

  it("blocks physical Target scope escapes and non-flat relay sessions", () => {
    expect(() =>
      authorizeCdpCommand("Target.sendMessageToTarget", {
        sessionId: "child",
        message: JSON.stringify({ id: 1, method: "Network.getAllCookies" }),
      }),
    ).toThrow(/credential firewall/);
    expect(() => authorizeCdpCommand("Target.exposeDevToolsProtocol", { targetId: "tab" })).toThrow(
      /credential firewall/,
    );
    expect(() =>
      authorizeCdpCommand("Target.setAutoAttach", {
        autoAttach: true,
        waitForDebuggerOnStart: false,
        flatten: false,
      }),
    ).toThrow(/flattened Target session/);
    expect(() =>
      authorizeCdpCommand("Target.attachToTarget", { targetId: "child", flatten: true }),
    ).toThrow(/credential firewall/);
    expect(() => authorizeCdpCommand("Target.getTargets")).toThrow(/credential firewall/);
    expect(() => authorizeCdpCommand("Target.getTargetInfo", { targetId: "other" })).toThrow(
      /credential firewall/,
    );
    expect(authorizeCdpCommand("Target.getTargetInfo", {})).toEqual({
      method: "Target.getTargetInfo",
      params: {},
    });
    expect(
      authorizeCdpCommand("Target.setAutoAttach", {
        autoAttach: true,
        waitForDebuggerOnStart: false,
        flatten: true,
      }),
    ).toEqual({
      method: "Target.setAutoAttach",
      params: { autoAttach: true, waitForDebuggerOnStart: false, flatten: true },
    });
    expect(authorizeCdpCommand("Target.detachFromTarget", { sessionId: "child" })).toEqual({
      method: "Target.detachFromTarget",
      params: { sessionId: "child" },
    });
  });

  it("removes nested Target event payloads from pre-existing non-flat sessions", () => {
    expect(
      sanitizeCdpEvent("Target.receivedMessageFromTarget", {
        sessionId: "child",
        targetId: "target-child",
        message: JSON.stringify({
          id: 1,
          result: { cookies: [{ name: "session", value: "secret" }] },
        }),
      }),
    ).toEqual({ sessionId: "child", targetId: "target-child" });
  });

  it("removes credential-bearing protocol fields", () => {
    const value = {
      headers: { Cookie: "secret", Authorization: "Bearer secret", Accept: "text/html" },
      responseHeaders: [
        { name: "Set-Cookie", value: "session=secret" },
        { name: "Content-Type", value: "text/html" },
      ],
      cookies: [{ name: "session", value: "secret" }],
      headersText: "Set-Cookie: session=secret",
    };
    const expected = {
      headers: { Accept: "text/html" },
      responseHeaders: [{ name: "Content-Type", value: "text/html" }],
      cookies: [],
    };
    expect(sanitizeCdpResult("Network.getResponseBody", value)).toEqual(expected);
    expect(sanitizeCdpEvent("Network.responseReceived", value)).toEqual(expected);
  });

  it("removes credential-bearing headers from cached request entries", () => {
    expect(
      sanitizeCdpResult("CacheStorage.requestEntries", {
        cacheDataEntries: [
          {
            requestURL: "https://example.test/private",
            requestHeaders: [
              { name: "Authorization", value: "Bearer secret" },
              { name: "Accept", value: "text/html" },
            ],
            responseHeaders: [
              { name: "Set-Cookie", value: "session=secret" },
              { name: "Content-Type", value: "text/html" },
            ],
          },
        ],
      }),
    ).toEqual({
      cacheDataEntries: [
        {
          requestURL: "https://example.test/private",
          requestHeaders: [{ name: "Accept", value: "text/html" }],
          responseHeaders: [{ name: "Content-Type", value: "text/html" }],
        },
      ],
    });
  });
});
