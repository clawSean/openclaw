import type { BrowserTabSnapshot } from "./tab-eligibility.js";

export const SHARED_TAB_IDS_KEY: string;
export const EXPLICIT_SELECTION_KEY: string;
export const MAX_SHARED_TABS: number;

type StorageArea = {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<unknown>;
};

type CreatedTabOperation = {
  tab: BrowserTabSnapshot;
  assertCurrent(): void;
};

export type SharedTabsController = {
  add(tabId: number, created?: CreatedTabOperation): Promise<void>;
  addExplicit(tabId: number): Promise<void>;
  clear(): Promise<void>;
  has(tabId: number): Promise<boolean>;
  isExplicit(): Promise<boolean>;
  isSelected(tab: BrowserTabSnapshot | null | undefined): Promise<boolean>;
  remove(tabId: number): Promise<void>;
  replaceTab(addedTabId: number, removedTabId: number): Promise<boolean>;
  replaceWith(tabId: number): Promise<void>;
};

export function createSharedTabsController(options: {
  chromeApi?: {
    storage: { local: StorageArea; session: StorageArea };
    tabs: {
      get(tabId: number): Promise<BrowserTabSnapshot>;
      ungroup(tabIds: number[]): Promise<unknown>;
    };
  };
  getGroupColor?: () => string | Promise<string>;
}): SharedTabsController;
