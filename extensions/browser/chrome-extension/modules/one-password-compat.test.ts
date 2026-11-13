import vm from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { beginIgnoreScope, createOnePasswordCompatibility } from "./one-password-compat.js";

function page(initial: string | null = null) {
  let value = initial;
  const timers = new Map<number, () => void>();
  let timerId = 0;
  const records: unknown[] = [];
  const events = new Map<string, () => void>();
  let observing = false;
  const body = {
    getAttribute: () => value,
    setAttribute: (_name: string, next: string) => {
      value = next;
      if (observing) {
        records.push({});
      }
    },
    removeAttribute: () => {
      value = null;
      if (observing) {
        records.push({});
      }
    },
  };
  const context = vm.createContext({
    document: { body },
    Symbol,
    setTimeout: (fn: () => void) => {
      timers.set(++timerId, fn);
      return timerId;
    },
    clearTimeout: (id: number) => timers.delete(id),
    addEventListener: (name: string, fn: () => void) => events.set(name, fn),
    removeEventListener: (name: string) => events.delete(name),
    MutationObserver: class {
      observe() {
        observing = true;
      }
      disconnect() {
        observing = false;
      }
      takeRecords() {
        return records.splice(0);
      }
    },
  });
  return {
    body,
    timers,
    events,
    begin: () =>
      vm.runInContext(`(${beginIgnoreScope.toString()})()`, context) as (op: string) => boolean,
  };
}
afterEach(() => vi.useRealTimers());

describe("1Password document cooperation", () => {
  it.each([null, "false", "site-value"])(
    "restores exact prior attribute %s only when released",
    (original) => {
      const p = page(original);
      const lease = p.begin();
      expect(p.body.getAttribute()).toBe("true");
      expect(lease("renew")).toBe(true);
      expect(p.body.getAttribute()).toBe("true");
      expect(p.timers.size).toBe(1);
      lease("release");
      expect(p.body.getAttribute()).toBe(original);
    },
  );
  it("shares an existing lease without capturing the synthetic true as original", () => {
    const p = page();
    const lease = p.begin();
    expect(p.begin()).toBe(lease);
    lease("release");
    expect(p.body.getAttribute()).toBe(null);
  });
  it("preserves page-owned changes and rejects renewal", () => {
    const p = page();
    const lease = p.begin();
    p.body.setAttribute("data-1p-ignore", "site-value");
    expect(lease("renew")).toBe(false);
    expect(p.body.getAttribute()).toBe("site-value");
  });
  it("cleans up after worker loss and does not revive an expired lease", () => {
    const p = page();
    const lease = p.begin();
    [...p.timers.values()][0]();
    expect(p.body.getAttribute()).toBe(null);
    expect(lease("renew")).toBe(false);
  });
  it("restores before navigation, including documents retained in BFCache", () => {
    const p = page();
    p.begin();
    p.events.get("pagehide")?.();
    expect(p.body.getAttribute()).toBe(null);
    expect(p.timers.size).toBe(0);
  });
  it("does nothing without opt-in, for other tabs, or child sessions", async () => {
    const compat = createOnePasswordCompatibility();
    const send = vi.fn();
    const action = vi.fn(async () => "result");
    await compat.run(7, undefined, "Input.dispatchMouseEvent", send, action);
    await compat.set(7, true);
    await compat.run(8, undefined, "Runtime.evaluate", send, action);
    await compat.run(7, "child", "Runtime.callFunctionOn", send, action);
    expect(send).not.toHaveBeenCalled();
    expect(action).toHaveBeenCalledTimes(3);
  });
  it("holds across asynchronous work and releases on explicit disable", async () => {
    vi.useFakeTimers();
    const p = page();
    let lease: (op: string) => boolean;
    const send = vi.fn(async (method: string, params: Record<string, unknown>) => {
      if (method === "Runtime.evaluate") {
        lease = p.begin();
        return { result: { objectId: "lease" } };
      }
      if (method === "Runtime.callFunctionOn") {
        return {
          result: { value: lease((params.arguments as Array<{ value: string }>)[0].value) },
        };
      }
      return {};
    });
    const compat = createOnePasswordCompatibility();
    await compat.set(7, true);
    await compat.run(7, undefined, "Input.dispatchMouseEvent", send, async () => {});
    await vi.advanceTimersByTimeAsync(250);
    expect(p.body.getAttribute()).toBe("true");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(p.body.getAttribute()).toBe("true");
    await compat.set(7, false);
    expect(p.body.getAttribute()).toBe(null);
    expect(compat.enabled(7)).toBe(false);
  });
  it("stops renewing when access is revoked, with cleanup through exact-target override", async () => {
    vi.useFakeTimers();
    const send = vi.fn(async () => ({ result: { objectId: "scope", value: true } }));
    const cleanup = vi.fn(async () => ({ result: { value: true } }));
    const compat = createOnePasswordCompatibility();
    await compat.set(7, true);
    await compat.run(
      7,
      undefined,
      "Runtime.evaluate",
      send,
      async () => {},
      async () => {},
    );
    await compat.stop(7, cleanup);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(send).toHaveBeenCalledTimes(1);
    expect(cleanup.mock.calls).toHaveLength(2);
  });
  it("rejects the next action immediately after the page changes the suppression attribute", async () => {
    vi.useFakeTimers();
    const send = vi.fn(async (method: string) =>
      method === "Runtime.evaluate"
        ? { result: { objectId: "scope" } }
        : { result: { value: false } },
    );
    const compat = createOnePasswordCompatibility();
    await compat.set(7, true);
    await compat.run(7, undefined, "Input.dispatchMouseEvent", send, async () => {});
    const nextAction = vi.fn();
    await expect(compat.run(7, undefined, "DOM.focus", send, nextAction)).rejects.toThrow(
      "action was not sent",
    );
    expect(nextAction).not.toHaveBeenCalled();
    expect(compat.enabled(7)).toBe(false);
  });

  it("does not dispatch when suppression cannot start", async () => {
    const compat = createOnePasswordCompatibility();
    await compat.set(7, true);
    const action = vi.fn();
    await expect(
      compat.run(7, undefined, "DOM.focus", async () => ({ exceptionDetails: {} }), action),
    ).rejects.toThrow("action was not sent");
    expect(action).not.toHaveBeenCalled();
    expect(compat.enabled(7)).toBe(false);
  });
});
