import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { beginIgnoreScope, createOnePasswordCompatibility } from "./one-password-compat.js";

function page(initial: string | null = null) {
  let value = initial;
  const timers: Array<() => void> = [];
  const records: unknown[] = [];
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
      timers.push(fn);
      return timers.length;
    },
    clearTimeout: () => {},
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
    begin: () => vm.runInContext(`(${beginIgnoreScope.toString()})()`, context) as () => boolean,
  };
}

describe("1Password cooperation scopes", () => {
  it.each([null, "false", "site-value"])(
    "restores exact prior attribute %s after overlapping actions",
    (original) => {
      const p = page(original);
      const first = p.begin();
      const second = p.begin();
      expect(p.body.getAttribute()).toBe("true");
      expect(first()).toBe(true);
      expect(p.body.getAttribute()).toBe("true");
      second();
      expect(p.body.getAttribute()).toBe(original);
    },
  );
  it("preserves a page-owned change made during automation", () => {
    const p = page();
    const end = p.begin();
    p.body.setAttribute("data-1p-ignore", "site-value");
    end();
    expect(p.body.getAttribute()).toBe("site-value");
  });
  it("cleans up after worker loss and reports expired scope", () => {
    const p = page();
    const end = p.begin();
    p.timers[0]();
    expect(p.body.getAttribute()).toBe(null);
    expect(end()).toBe(false);
  });
  it("an expired old lease does not restore over an overlapping action", () => {
    const p = page();
    p.begin();
    const second = p.begin();
    p.timers[0]();
    expect(p.body.getAttribute()).toBe("true");
    second();
    expect(p.body.getAttribute()).toBe(null);
  });
  it("does nothing without per-tab opt-in, for other tabs, or child sessions", async () => {
    const compat = createOnePasswordCompatibility();
    const send = vi.fn();
    const action = vi.fn(async () => "result");
    await compat.run(7, undefined, "Input.dispatchMouseEvent", send, action);
    compat.set(7, true);
    await compat.run(8, undefined, "Runtime.evaluate", send, action);
    await compat.run(7, "child", "Runtime.callFunctionOn", send, action);
    expect(send).not.toHaveBeenCalled();
    expect(action).toHaveBeenCalledTimes(3);
  });
  it("restores on action failure without replaying the action", async () => {
    const compat = createOnePasswordCompatibility();
    compat.set(7, true);
    const send = vi.fn(async (method: string) =>
      method === "Runtime.evaluate"
        ? { result: { objectId: "scope" } }
        : { result: { value: true } },
    );
    const action = vi.fn(async () => {
      throw new Error("action failed");
    });
    await expect(compat.run(7, undefined, "Runtime.evaluate", send, action)).rejects.toThrow(
      "action failed",
    );
    expect(action).toHaveBeenCalledTimes(1);
    expect(send.mock.calls.map(([method]) => method)).toEqual([
      "Runtime.evaluate",
      "Runtime.callFunctionOn",
      "Runtime.releaseObject",
    ]);
  });
  it("does not dispatch when suppression cannot start", async () => {
    const compat = createOnePasswordCompatibility();
    compat.set(7, true);
    const action = vi.fn();
    await expect(
      compat.run(7, undefined, "DOM.focus", async () => ({ exceptionDetails: {} }), action),
    ).rejects.toThrow("action was not sent");
    expect(action).not.toHaveBeenCalled();
  });
});
