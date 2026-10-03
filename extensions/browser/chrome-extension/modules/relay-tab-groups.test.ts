import { afterEach, describe, expect, it, vi } from "vitest";
import { isTabSelected } from "./relay-tab-groups.js";
import { createTabAccessPolicy } from "./tab-access.js";

const TAB_GROUP_LOOKUP_TIMEOUT_MS = 1_000;

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("selected tab-group lookup", () => {
  it("accepts only the OpenClaw group", async () => {
    const get = vi.fn(async () => ({ id: 7, title: "OpenClaw" }));
    vi.stubGlobal("chrome", { tabGroups: { get } });

    await expect(isTabSelected({ id: 1, groupId: 7 })).resolves.toBe(true);
    expect(get).toHaveBeenCalledWith(7);
  });

  it("fails closed when a Chromium-family browser never settles the lookup", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("chrome", {
      tabGroups: { get: vi.fn(() => new Promise(() => {})) },
    });

    const selected = isTabSelected({ id: 1, groupId: 7 });
    await vi.advanceTimersByTimeAsync(TAB_GROUP_LOOKUP_TIMEOUT_MS);

    await expect(selected).resolves.toBe(false);
  });

  it("bounds a whole grouped-tab inventory with concurrent lookups", async () => {
    vi.useFakeTimers();
    const tabs = Array.from({ length: 12 }, (_, index) => ({
      id: index + 1,
      groupId: index + 10,
      url: `https://example.com/${index + 1}`,
      windowId: 1,
      incognito: false,
    }));
    const get = vi.fn(() => new Promise(() => {}));
    const sessionValues: Record<string, unknown> = {};
    const chromeApi = {
      extension: { isAllowedFileSchemeAccess: vi.fn(async () => false) },
      storage: {
        session: {
          get: vi.fn(async () => ({ ...sessionValues })),
          set: vi.fn(async (values: Record<string, unknown>) => {
            Object.assign(sessionValues, values);
          }),
          remove: vi.fn(async (keys: string[]) => {
            for (const key of keys) {
              delete sessionValues[key];
            }
          }),
        },
      },
      tabs: {
        get: vi.fn(async (tabId: number) => {
          const tab = tabs.find((candidate) => candidate.id === tabId);
          if (!tab) {
            throw new Error(`missing tab ${tabId}`);
          }
          return tab;
        }),
        query: vi.fn(async () => tabs),
      },
      tabGroups: { get },
    };
    vi.stubGlobal("chrome", chromeApi);
    const policy = createTabAccessPolicy({ chromeApi, isSelectedTab: isTabSelected });
    await policy.initialize("selected", true);

    const listing = policy.listAccessibleTabs();
    await vi.advanceTimersByTimeAsync(TAB_GROUP_LOOKUP_TIMEOUT_MS);

    await expect(listing).resolves.toEqual([]);
    expect(get).toHaveBeenCalledTimes(tabs.length);
  });
});
