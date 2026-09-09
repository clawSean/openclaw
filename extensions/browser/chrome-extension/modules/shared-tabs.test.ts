import { describe, expect, it, vi } from "vitest";
import {
  createSharedTabsController,
  EXPLICIT_SELECTION_KEY,
  SHARED_TAB_IDS_KEY,
} from "./shared-tabs.js";

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function createHarness({
  explicit = false,
  ids = [1, 2],
}: { explicit?: boolean; ids?: number[] } = {}) {
  const localValues: Record<string, unknown> = explicit ? { [EXPLICIT_SELECTION_KEY]: true } : {};
  const sessionValues: Record<string, unknown> = { [SHARED_TAB_IDS_KEY]: ids };
  const tabs = new Map(ids.concat([3]).map((id) => [id, { id, windowId: 1, incognito: false }]));
  const local = {
    get: vi.fn(async (keys: string[]) =>
      Object.fromEntries(
        keys.filter((key) => Object.hasOwn(localValues, key)).map((key) => [key, localValues[key]]),
      ),
    ),
    set: vi.fn(async (values: Record<string, unknown>) => Object.assign(localValues, values)),
  };
  const session = {
    get: vi.fn(async (keys: string[]) =>
      Object.fromEntries(
        keys
          .filter((key) => Object.hasOwn(sessionValues, key))
          .map((key) => [key, sessionValues[key]]),
      ),
    ),
    set: vi.fn(async (values: Record<string, unknown>): Promise<void> => {
      Object.assign(sessionValues, values);
    }),
  };
  const chromeApi = {
    storage: { local, session },
    tabs: {
      get: vi.fn(async (tabId: number) => {
        const tab = tabs.get(tabId);
        if (!tab) throw new Error(`No tab ${tabId}`);
        return tab;
      }),
      ungroup: vi.fn(async () => undefined),
    },
  };
  return {
    chromeApi,
    controller: createSharedTabsController({ chromeApi }),
    local,
    localValues,
    session,
    sessionValues,
    tabs,
  };
}

describe("personal shared-tab selection", () => {
  it("restores the explicit session selection after an MV3 worker restart", async () => {
    const harness = createHarness({ explicit: true, ids: [1, 2, 2, -1] });

    await expect(harness.controller.has(1)).resolves.toBe(true);
    await expect(harness.controller.has(2)).resolves.toBe(true);
    await expect(harness.controller.has(3)).resolves.toBe(false);
  });

  it("replaces the full selection with one atomic session write", async () => {
    const harness = createHarness({ explicit: true });

    await harness.controller.replaceWith(3);

    expect(harness.session.set).toHaveBeenCalledTimes(1);
    expect(harness.session.set).toHaveBeenCalledWith({ [SHARED_TAB_IDS_KEY]: [3] });
    await expect(harness.controller.has(1)).resolves.toBe(false);
    await expect(harness.controller.has(3)).resolves.toBe(true);
  });

  it("does not expose a replacement before its session write commits", async () => {
    const harness = createHarness({ explicit: true });
    const gate = deferred();
    harness.session.set.mockImplementationOnce(async (values: Record<string, unknown>) => {
      await gate.promise;
      Object.assign(harness.sessionValues, values);
    });

    const replacing = harness.controller.replaceWith(3);
    const reading = harness.controller.has(3);
    await vi.waitFor(() =>
      expect(harness.session.set).toHaveBeenCalledWith({ [SHARED_TAB_IDS_KEY]: [3] }),
    );
    let settled = false;
    void reading.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    gate.resolve();
    await expect(replacing).resolves.toBeUndefined();
    await expect(reading).resolves.toBe(true);
  });

  it("leaves the prior selection unchanged when target validation fails", async () => {
    const harness = createHarness({ explicit: true });

    await expect(harness.controller.replaceWith(99)).rejects.toThrow("No tab 99");
    expect(harness.session.set).not.toHaveBeenCalled();
    await expect(harness.controller.has(1)).resolves.toBe(true);
    await expect(harness.controller.has(2)).resolves.toBe(true);
  });

  it("fails closed when the explicit session selection cannot be read", async () => {
    const harness = createHarness({ explicit: true });
    harness.session.get.mockRejectedValueOnce(new Error("session unavailable"));
    const controller = createSharedTabsController({ chromeApi: harness.chromeApi });

    await expect(controller.has(1)).resolves.toBe(false);
    await expect(controller.addExplicit(3)).rejects.toThrow("no tabs were shared");
  });

  it("fails closed for the worker lifetime after a session write failure", async () => {
    const harness = createHarness({ explicit: true });
    harness.session.set.mockRejectedValueOnce(new Error("write failed"));

    await expect(harness.controller.replaceWith(3)).rejects.toThrow("no tabs were shared");
    await expect(harness.controller.has(1)).resolves.toBe(false);
    await expect(harness.controller.has(3)).resolves.toBe(false);
    await expect(harness.controller.addExplicit(3)).rejects.toThrow("no tabs were shared");
  });

  it("activates explicit selection persistently but keeps tab ids session-scoped", async () => {
    const harness = createHarness({ explicit: false, ids: [] });

    await harness.controller.replaceWith(3);

    expect(harness.local.set).toHaveBeenCalledWith({ [EXPLICIT_SELECTION_KEY]: true });
    expect(harness.session.set).toHaveBeenCalledWith({ [SHARED_TAB_IDS_KEY]: [3] });
  });

  it("clears explicit tab consent without disabling the explicit backend", async () => {
    const harness = createHarness({ explicit: true });

    await harness.controller.clear();

    expect(harness.session.set).toHaveBeenCalledWith({ [SHARED_TAB_IDS_KEY]: [] });
    await expect(harness.controller.isExplicit()).resolves.toBe(true);
    await expect(harness.controller.has(1)).resolves.toBe(false);
  });

  it("removes closed tab ids from the explicit ledger", async () => {
    const harness = createHarness({ explicit: true });

    await harness.controller.remove(1);

    expect(harness.session.set).toHaveBeenCalledWith({ [SHARED_TAB_IDS_KEY]: [2] });
    await expect(harness.controller.has(1)).resolves.toBe(false);
    await expect(harness.controller.has(2)).resolves.toBe(true);
  });

  it("moves explicit consent to Chromium's replacement tab id", async () => {
    const harness = createHarness({ explicit: true });

    await expect(harness.controller.replaceTab(3, 1)).resolves.toBe(true);

    expect(harness.session.set).toHaveBeenNthCalledWith(1, { [SHARED_TAB_IDS_KEY]: [2] });
    expect(harness.session.set).toHaveBeenNthCalledWith(2, { [SHARED_TAB_IDS_KEY]: [2, 3] });
    await expect(harness.controller.has(1)).resolves.toBe(false);
    await expect(harness.controller.has(3)).resolves.toBe(true);
  });

  it("waits briefly for Arc to publish a selected replacement tab", async () => {
    const harness = createHarness({ explicit: true });
    harness.chromeApi.tabs.get
      .mockRejectedValueOnce(new Error("replacement not ready"))
      .mockResolvedValueOnce({ id: 3, windowId: 1, incognito: false });

    await expect(harness.controller.replaceTab(3, 1)).resolves.toBe(true);

    expect(harness.session.set).toHaveBeenNthCalledWith(1, { [SHARED_TAB_IDS_KEY]: [2] });
    expect(harness.session.set).toHaveBeenNthCalledWith(2, { [SHARED_TAB_IDS_KEY]: [2, 3] });
    await expect(harness.controller.has(1)).resolves.toBe(false);
    await expect(harness.controller.has(3)).resolves.toBe(true);
  });

  it("drops a stale selected id when its replacement cannot be validated", async () => {
    const harness = createHarness({ explicit: true });

    await expect(harness.controller.replaceTab(99, 1)).rejects.toThrow("No tab 99");

    expect(harness.session.set).toHaveBeenCalledTimes(1);
    expect(harness.session.set).toHaveBeenCalledWith({ [SHARED_TAB_IDS_KEY]: [2] });
    await expect(harness.controller.has(1)).resolves.toBe(false);
  });
});
