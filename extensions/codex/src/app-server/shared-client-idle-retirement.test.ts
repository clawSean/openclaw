import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CodexAppServerClient } from "./client.js";
import {
  armSharedCodexAppServerClientIdleRetirement,
  getSharedCodexAppServerClientState,
  retainSharedClientEntry,
  retireSharedCodexAppServerClientIfCurrent,
  type SharedCodexAppServerClientEntry,
} from "./shared-client-lifecycle.js";

function installSharedClient() {
  const state = getSharedCodexAppServerClientState();
  const close = vi.fn();
  const client = { close } as unknown as CodexAppServerClient;
  const entry: SharedCodexAppServerClientEntry = {
    key: "synthetic-client",
    client,
    activeLeases: 0,
    anonymousLeases: 0,
    pendingAcquires: 0,
    closeWhenIdle: false,
    onStartedClientCallbacks: new Set(),
  };
  state.clients.set(entry.key, entry);
  state.liveClients.add(client);
  state.entriesByClient.set(client, entry);
  return { state, entry, client, close };
}

describe("shared Codex app-server idle retirement", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    const state = getSharedCodexAppServerClientState();
    state.clients.clear();
    state.liveClients.clear();
    state.entriesByClient = new WeakMap();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("retires an unclaimed client after its idle grace", async () => {
    const { state, client, close } = installSharedClient();

    expect(
      armSharedCodexAppServerClientIdleRetirement(client, {
        timeoutMs: 100,
        canRetire: () => true,
      }),
    ).toBe(true);

    await vi.advanceTimersByTimeAsync(99);
    expect(close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(close).toHaveBeenCalledOnce();
    expect(state.clients.size).toBe(0);
  });

  it("restarts the idle grace after a lease drains", async () => {
    const { entry, client, close } = installSharedClient();
    armSharedCodexAppServerClientIdleRetirement(client, {
      timeoutMs: 100,
      canRetire: () => true,
    });

    await vi.advanceTimersByTimeAsync(50);
    const release = retainSharedClientEntry(entry);
    await vi.advanceTimersByTimeAsync(100);
    expect(close).not.toHaveBeenCalled();

    release();
    await vi.advanceTimersByTimeAsync(99);
    expect(close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(close).toHaveBeenCalledOnce();
  });

  it("defers retirement while native thread ownership remains", async () => {
    const { client, close } = installSharedClient();
    let hasThreadOwnership = true;
    armSharedCodexAppServerClientIdleRetirement(client, {
      timeoutMs: 100,
      canRetire: () => !hasThreadOwnership,
    });

    await vi.advanceTimersByTimeAsync(100);
    expect(close).not.toHaveBeenCalled();
    hasThreadOwnership = false;
    await vi.advanceTimersByTimeAsync(100);
    expect(close).toHaveBeenCalledOnce();
  });

  it("does not schedule a second retirement after graceful detachment", async () => {
    const { entry, client, close } = installSharedClient();
    armSharedCodexAppServerClientIdleRetirement(client, {
      timeoutMs: 100,
      canRetire: () => true,
    });
    const release = retainSharedClientEntry(entry);
    expect(retireSharedCodexAppServerClientIfCurrent(client)).toEqual({
      activeLeases: 1,
      closed: false,
    });
    release();

    await vi.advanceTimersByTimeAsync(100);
    expect(close).toHaveBeenCalledOnce();
    expect(entry.idleRetirement).toBeUndefined();
  });
});
