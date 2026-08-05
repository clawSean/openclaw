import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { OpenClawConfig, TelegramAccountConfig } from "openclaw/plugin-sdk/config-contracts";
import { describe, expect, it } from "vitest";

/**
 * This is deliberately a contract test, not a matcher unit test.  It uses the
 * existing createTelegramBot middleware-chain harness once that harness exposes
 * a raw-update ingress runner.  The runner is TEST-ONLY instrumentation: it
 * must call the real bot.handleUpdate/update middleware chain and expose direct
 * counters for middleware and handler boundaries that the existing fake Bot
 * can observe directly; it must not synthesize session/model artifacts.
 *
 * Required test-harness implementation (not a bot-core production export):
 *
 * createRawTelegramUpdateIngressHarnessForTest({ stateDir, config, accountId,
 * botUsername }) -> {
 *   handleLiveUpdate(rawUpdate),
 *   handleSpooledReplayUpdate(rawUpdate), // runWithTelegramSpooledReplayUpdate(
 *                                          // rawUpdate, () => bot.handleUpdate(rawUpdate))
 *   awaitPersistenceIdle(),
 *   dispose(),
 *   observers: direct spies/counters named below,
 * }
 *
 * The core-side admission middleware must be a normal production middleware or
 * admission function used by the update-tracker wrapper.  It must run after
 * beginUpdate accepts and before callback handling and sequentialize.  This
 * This test exercises that ordering without claiming visibility into session,
 * transcript, run, or model stores that this harness does not own.
 */
const testHarness = await import("./bot.create-telegram-bot.test-harness.js");

type UpdateKind = "message" | "edited_message" | "channel_post" | "edited_channel_post";
type ChatType = "private" | "group" | "supergroup" | "channel";
type IgnoreConfig = TelegramAccountConfig & { agentIgnorePrefixes?: string[] };

type RawTelegramMessage = {
  message_id: number;
  date: number;
  chat: { id: number; type: ChatType; title?: string };
  from?: { id: number; is_bot: boolean; first_name: string; username?: string };
  sender_chat?: { id: number; type: "channel"; title: string };
  message_thread_id?: number;
  text?: string;
  caption?: string;
  photo?: Array<{
    file_id: string;
    file_unique_id: string;
    width: number;
    height: number;
  }>;
};

/** Actual Telegram Update variants: exactly one update payload key per fixture. */
type RawTelegramUpdate =
  | { update_id: number; message: RawTelegramMessage }
  | { update_id: number; edited_message: RawTelegramMessage }
  | { update_id: number; channel_post: RawTelegramMessage }
  | { update_id: number; edited_channel_post: RawTelegramMessage };

type DirectObserver = { calls(): number };
type RawTelegramUpdateIngressHarness = {
  handleLiveUpdate(update: RawTelegramUpdate): Promise<void>;
  handleSpooledReplayUpdate(update: RawTelegramUpdate): Promise<void>;
  awaitPersistenceIdle(): Promise<void>;
  dispose(): Promise<void>;
  /** Each is wired directly to the tracker callback or real registered chain. */
  observers: {
    updateWatermarkWrite: DirectObserver;
    callbackMiddleware: DirectObserver;
    sequentialize: DirectObserver;
    downstreamHandler: DirectObserver;
  };
};

type RawIngressHarnessFactory = (params: {
  stateDir: string;
  config: OpenClawConfig;
  accountId: string;
  botUsername: string;
}) => Promise<RawTelegramUpdateIngressHarness>;

const rawIngressFactory = (
  testHarness as unknown as {
    createRawTelegramUpdateIngressHarnessForTest?: RawIngressHarnessFactory;
  }
).createRawTelegramUpdateIngressHarnessForTest;

const CHAT_ID = -1001234567890;
const TOPIC_ID = 42;
const DM_CHAT_ID = 123456789;
const BOT_USERNAME = "CurrentBot";
const ACCOUNT_ID = "morty";

function createConfig(account: IgnoreConfig): OpenClawConfig {
  return {
    agents: { defaults: { envelopeTimezone: "utc" } },
    channels: {
      telegram: {
        dmPolicy: "open",
        allowFrom: ["*"],
        accounts: { [ACCOUNT_ID]: account },
      },
    },
  };
}

/** Exact group is enabled but deliberately has no prefix override. */
function neutralScopeConfig(): OpenClawConfig {
  return createConfig({
    agentIgnorePrefixes: [" /ignore "],
    groups: { [String(CHAT_ID)]: { enabled: true, requireMention: false } },
  });
}

function scopedConfig(): OpenClawConfig {
  return createConfig({
    agentIgnorePrefixes: ["/account"],
    groups: {
      [String(CHAT_ID)]: {
        enabled: true,
        requireMention: false,
        agentIgnorePrefixes: ["/group"],
        topics: { [String(TOPIC_ID)]: { agentIgnorePrefixes: ["/topic"] } },
      },
    },
  });
}

function rawUpdate(params: {
  updateId: number;
  messageId: number;
  kind: UpdateKind;
  chatId?: number;
  chatType?: ChatType;
  messageThreadId?: number;
  text?: string;
  caption?: string;
}): RawTelegramUpdate {
  const chatId = params.chatId ?? CHAT_ID;
  const chatType = params.chatType ?? "supergroup";
  const message: RawTelegramMessage = {
    message_id: params.messageId,
    date: 1_754_406_400,
    chat: {
      id: chatId,
      type: chatType,
      ...(chatType === "private" ? {} : { title: chatType === "channel" ? "Announcements" : "Team" }),
    },
    ...(chatType === "channel"
      ? { sender_chat: { id: chatId, type: "channel", title: "Announcements" } }
      : { from: { id: 9001, is_bot: false, first_name: "Human", username: "human" } }),
    ...(params.messageThreadId === undefined
      ? {}
      : { message_thread_id: params.messageThreadId }),
    ...(params.text === undefined ? {} : { text: params.text }),
    ...(params.caption === undefined
      ? {}
      : {
          caption: params.caption,
          // A caption arrives on media; retain the raw Telegram media shape.
          photo: [{ file_id: "photo-id", file_unique_id: "photo-unique", width: 1, height: 1 }],
        }),
  };
  return { update_id: params.updateId, [params.kind]: message } as RawTelegramUpdate;
}

function expectObservedObserverCoverage(harness: RawTelegramUpdateIngressHarness): void {
  const required: Array<keyof RawTelegramUpdateIngressHarness["observers"]> = [
    "updateWatermarkWrite",
    "callbackMiddleware",
    "sequentialize",
    "downstreamHandler",
  ];
  for (const name of required) {
    expect(harness.observers[name], `missing direct observer for ${name}`).toBeDefined();
    expect(harness.observers[name].calls).toBeTypeOf("function");
  }
}

async function withRawIngressHarness<T>(
  config: OpenClawConfig,
  test: (harness: RawTelegramUpdateIngressHarness) => Promise<T>,
): Promise<T> {
  // A fresh bot/tracker per assertion prevents watermark carry-over.
  const stateDir = mkdtempSync(path.join(tmpdir(), "openclaw-ignore-zero-turn-"));
  const harness = await rawIngressFactory!({
    stateDir,
    config,
    accountId: ACCOUNT_ID,
    botUsername: BOT_USERNAME,
  });
  try {
    expectObservedObserverCoverage(harness);
    return await test(harness);
  } finally {
    await harness.dispose();
    rmSync(stateDir, { recursive: true, force: true });
  }
}

async function processAndDrain(
  harness: RawTelegramUpdateIngressHarness,
  delivery: "live" | "spooled-replay",
  update: RawTelegramUpdate,
): Promise<void> {
  if (delivery === "live") {
    await harness.handleLiveUpdate(update);
  } else {
    await harness.handleSpooledReplayUpdate(update);
  }
  // Tracker persistence is async; assertions must observe the completed drain.
  await harness.awaitPersistenceIdle();
}

function expectZeroTurn(harness: RawTelegramUpdateIngressHarness): void {
  // The accepted-update watermark is the sole observed persistence boundary.
  expect(harness.observers.updateWatermarkWrite.calls()).toBeGreaterThan(0);
  expect(harness.observers.callbackMiddleware.calls()).toBe(0);
  expect(harness.observers.sequentialize.calls()).toBe(0);
  expect(harness.observers.downstreamHandler.calls()).toBe(0);
}

function expectNormalPassThrough(harness: RawTelegramUpdateIngressHarness): void {
  expect(harness.observers.updateWatermarkWrite.calls()).toBeGreaterThan(0);
  expect(harness.observers.callbackMiddleware.calls()).toBeGreaterThan(0);
  expect(harness.observers.sequentialize.calls()).toBeGreaterThan(0);
  expect(harness.observers.downstreamHandler.calls()).toBeGreaterThan(0);
}

describe("agentIgnorePrefixes zero-turn raw Telegram ingress contract", () => {
  it("requires the existing test harness to expose a real raw-update ingress seam", () => {
    expect(rawIngressFactory).toBeTypeOf("function");
  });

  // The runner executes the registered middleware chain, not a production
  // matcher factory or a self-reported drop result.
  const describeWithRawIngress = rawIngressFactory ? describe : describe.skip;

  describeWithRawIngress("with the real update ingress", () => {
    it("uses the same admission path for live and spooled replay before callback handling and sequentialize", async () => {
      await withRawIngressHarness(neutralScopeConfig(), async (harness) => {
        await processAndDrain(harness, "live", rawUpdate({
          updateId: 10_001, messageId: 20_001, kind: "message",
          text: " \t/IgNoRe@cUrReNtBoT human-only",
        }));
        expectZeroTurn(harness);
      });
      await withRawIngressHarness(neutralScopeConfig(), async (harness) => {
        await processAndDrain(harness, "spooled-replay", rawUpdate({
          updateId: 10_002, messageId: 20_002, kind: "message",
          text: " \t/IgNoRe@cUrReNtBoT human-only",
        }));
        expectZeroTurn(harness);
      });
    });

    it.each([
      ["message text", 10_010, 20_010, "message", "supergroup", { text: "/ignore human-only" }],
      ["edited_message text", 10_011, 20_011, "edited_message", "supergroup", { text: "/ignore human-only" }],
      ["channel_post text", 10_012, 20_012, "channel_post", "channel", { text: "/ignore human-only" }],
      ["edited_channel_post text", 10_013, 20_013, "edited_channel_post", "channel", { text: "/ignore human-only" }],
      ["message caption", 10_014, 20_014, "message", "supergroup", { caption: "/ignore human-only" }],
      ["edited_message caption", 10_015, 20_015, "edited_message", "supergroup", { caption: "/ignore human-only" }],
      ["channel_post caption", 10_016, 20_016, "channel_post", "channel", { caption: "/ignore human-only" }],
      ["edited_channel_post caption", 10_017, 20_017, "edited_channel_post", "channel", { caption: "/ignore human-only" }],
    ] as const)("zero-turns matching %s", async (_label, updateId, messageId, kind, chatType, content) => {
      await withRawIngressHarness(neutralScopeConfig(), async (harness) => {
        await processAndDrain(harness, "live", rawUpdate({ updateId, messageId, kind, chatType, ...content }));
        expectZeroTurn(harness);
      });
    });

    it("uses text before caption when both raw fields are present", async () => {
      await withRawIngressHarness(neutralScopeConfig(), async (harness) => {
        await processAndDrain(harness, "live", rawUpdate({
          updateId: 10_020, messageId: 20_020, kind: "message",
          text: "ordinary text", caption: "/ignore ignored-caption",
        }));
        expectNormalPassThrough(harness);
      });
      await withRawIngressHarness(neutralScopeConfig(), async (harness) => {
        await processAndDrain(harness, "live", rawUpdate({
          updateId: 10_021, messageId: 20_021, kind: "message",
          text: "/ignore human-only", caption: "ordinary caption",
        }));
        expectZeroTurn(harness);
      });
    });

    it("honors account, group, then topic prefixes with the most-specific configured scope winning", async () => {
      await withRawIngressHarness(createConfig({ agentIgnorePrefixes: ["/account"] }), async (harness) => {
        await processAndDrain(harness, "live", rawUpdate({ updateId: 10_030, messageId: 20_030, kind: "message", text: "/account payload" }));
        expectZeroTurn(harness);
      });
      await withRawIngressHarness(scopedConfig(), async (harness) => {
        await processAndDrain(harness, "live", rawUpdate({ updateId: 10_031, messageId: 20_031, kind: "message", text: "/account payload" }));
        expectNormalPassThrough(harness);
      });
      await withRawIngressHarness(scopedConfig(), async (harness) => {
        await processAndDrain(harness, "live", rawUpdate({ updateId: 10_032, messageId: 20_032, kind: "message", text: "/group payload" }));
        expectZeroTurn(harness);
      });
      await withRawIngressHarness(scopedConfig(), async (harness) => {
        await processAndDrain(harness, "live", rawUpdate({ updateId: 10_033, messageId: 20_033, kind: "message", messageThreadId: TOPIC_ID, text: "/group payload" }));
        expectNormalPassThrough(harness);
      });
      await withRawIngressHarness(scopedConfig(), async (harness) => {
        await processAndDrain(harness, "live", rawUpdate({ updateId: 10_034, messageId: 20_034, kind: "message", messageThreadId: TOPIC_ID, text: "/topic payload" }));
        expectZeroTurn(harness);
      });
    });

    it.each([
      ["bare command", 10_040, 20_040, "/ignore"],
      ["whitespace-only tail", 10_041, 20_041, "/ignore \t "],
      ["bare current-bot mention", 10_042, 20_042, "/ignore@CurrentBot"],
      ["whitespace-only current-bot mention", 10_043, 20_043, "/ignore@CurrentBot   "],
      ["wrong bot mention", 10_045, 20_045, "/ignore@OtherBot payload"],
      ["command-boundary near match", 10_046, 20_046, "/ignorefoo payload"],
    ] as const)("passes %s through normal command/turn handling", async (_label, updateId, messageId, text) => {
      await withRawIngressHarness(neutralScopeConfig(), async (harness) => {
        await processAndDrain(harness, "live", rawUpdate({ updateId, messageId, kind: "message", text }));
        expectNormalPassThrough(harness);
      });
    });

    it("keeps real positive-id DMs out of scope", async () => {
      await withRawIngressHarness(neutralScopeConfig(), async (harness) => {
        await processAndDrain(harness, "live", rawUpdate({
          updateId: 10_050, messageId: 20_050, kind: "message", chatId: DM_CHAT_ID,
          chatType: "private", text: "/ignore human-only direct-message",
        }));
        expectNormalPassThrough(harness);
      });
    });

    it("anti-vacuity: crosses every observed boundary for an ordinary message", async () => {
      await withRawIngressHarness(neutralScopeConfig(), async (harness) => {
        await processAndDrain(harness, "live", rawUpdate({
          updateId: 10_070, messageId: 20_070, kind: "message", text: "ordinary group message",
        }));
        expectNormalPassThrough(harness);
      });
    });
  });

  // TODO(album): Media groups are intentionally excluded.  Do not infer per-update
  // behavior until product defines album admission and the media-group buffer is
  // observable through the same real persistence-boundary harness.
});
