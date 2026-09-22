// Telegram tests cover inbound buffering identity.
import "./bot-handlers.inbound-media.test-support.js";
import type { Context } from "grammy";
import type { Message } from "grammy/types";
import { createDeferred } from "openclaw/plugin-sdk/extension-shared";
import { describe, expect, it, vi } from "vitest";
import {
  buildTelegramInboundDebounceConversationKey,
  buildTelegramInboundDebounceKey,
} from "./bot-handlers.debounce-key.js";
import type { TelegramHandlerAuthorization } from "./bot-handlers.inbound-authorization.js";
import type { TelegramMessagePipeline } from "./bot-handlers.message-pipeline.js";
import type { RegisterTelegramHandlerParams } from "./bot-handlers.types.js";

const inboundProcessing = vi.hoisted(() => ({
  processInboundMessage: vi.fn(),
  beginPendingBufferedMessageIgnore: vi.fn(),
  beginPendingMediaGroupIgnore: vi.fn(),
}));

vi.mock("./bot-handlers.inbound-processing.js", () => ({
  createTelegramInboundProcessing: () => inboundProcessing,
}));

const { createTelegramInboundPipeline } = await import("./bot-handlers.inbound-pipeline.js");

describe("buildTelegramInboundDebounceKey", () => {
  it("isolates accounts and senders while normalizing the absent account", () => {
    const conversationKey = "12345";
    const senderId = "67890";
    const defaultKey = buildTelegramInboundDebounceKey({ conversationKey, senderId });
    expect(
      buildTelegramInboundDebounceKey({ accountId: "default", conversationKey, senderId }),
    ).toBe(defaultKey);
    expect(
      buildTelegramInboundDebounceKey({ accountId: "work", conversationKey, senderId }),
    ).not.toBe(defaultKey);
    expect(buildTelegramInboundDebounceKey({ conversationKey, senderId: "67891" })).not.toBe(
      defaultKey,
    );
  });

  it("keeps scoped topic thread ids in the conversation key", () => {
    const topic100 = buildTelegramInboundDebounceConversationKey({
      chatId: 7,
      threadSpec: { id: 100, scope: "forum" },
    });
    const topic200 = buildTelegramInboundDebounceConversationKey({
      chatId: 7,
      threadSpec: { id: 200, scope: "forum" },
    });

    expect(topic100).toBe("7:topic:100");
    expect(topic200).toBe("7:topic:200");
    expect(
      buildTelegramInboundDebounceConversationKey({
        chatId: 7,
        threadSpec: { id: 100, scope: "direct-messages" },
      }),
    ).toBe("7:direct-topic:100");
    expect(
      buildTelegramInboundDebounceKey({
        accountId: "default",
        conversationKey: topic100,
        senderId: "42",
      }),
    ).not.toBe(
      buildTelegramInboundDebounceKey({
        accountId: "default",
        conversationKey: topic200,
        senderId: "42",
      }),
    );
  });

  it("uses the chat id as the conversation key when no thread is present", () => {
    expect(
      buildTelegramInboundDebounceConversationKey({ chatId: 7, threadSpec: { scope: "none" } }),
    ).toBe("7");
  });
});

describe("album prompt-context ordering", () => {
  it("records an album member before handing it to the delayed media flush", async () => {
    inboundProcessing.beginPendingBufferedMessageIgnore.mockReset();
    inboundProcessing.beginPendingMediaGroupIgnore.mockReset();
    inboundProcessing.processInboundMessage.mockReset();
    const recordMessageForReplyChain = vi.fn(async () => undefined);
    inboundProcessing.processInboundMessage.mockImplementationOnce(async () => {
      expect(recordMessageForReplyChain).toHaveBeenCalledOnce();
      return { kind: "completed" };
    });
    const authorization = {
      authorizeInboundMessage: vi.fn(async () => ({
        allowed: true,
        effectiveDmAllow: [],
        context: {
          cfg: {},
          telegramCfg: {},
          dmPolicy: "open",
          threadSpec: { scope: "none" },
          storeAllowFrom: [],
          effectiveGroupAllow: [],
        },
      })),
    } as unknown as TelegramHandlerAuthorization;
    const params = {
      accountId: "default",
      bot: { api: { getChat: vi.fn(), sendMessage: vi.fn() } },
      cfg: { commands: { native: true } },
      opts: { botInfo: { id: 7, username: "openclaw_bot" } },
      runtime: { error: vi.fn() },
      shouldSkipUpdate: () => false,
      telegramCfg: { commands: { native: true } },
    } as unknown as RegisterTelegramHandlerParams;
    const message = {
      normalizePromptContextMinTimestampMs: () => undefined,
      promptContextBoundaryOptions: () => ({}),
      releaseDispatchDedupeClaims: vi.fn(),
      claimMessageDispatchDedupe: vi.fn(async () => ({ process: true, claims: [] })),
      buildSyntheticContext: (ctx: Context, syntheticMessage: Message) =>
        Object.assign(ctx, { message: syntheticMessage }),
      resolveTelegramSessionState: () => ({
        sessionEntry: undefined,
        sessionKey: "album-ordering",
        storePath: "album-ordering",
      }),
      resolvePromptContextAmbientWatermark: () => undefined,
      recordMessageForReplyChain,
      removeMessageFromReplyChain: vi.fn(),
      isMessageIgnoredForReplyChain: vi.fn(async () => false),
    } as unknown as TelegramMessagePipeline;
    const pipeline = createTelegramInboundPipeline({ params, message, authorization });
    const msg = {
      chat: { id: 42, type: "private", first_name: "Ada" },
      message_id: 11,
      date: 1_736_371_600,
      media_group_id: "album-before-question",
      from: { id: 9, is_bot: false, first_name: "Ada" },
      caption: "Deployment diagram",
      photo: [{ file_id: "p1", file_unique_id: "u1", width: 1, height: 1 }],
    } as Message;

    await pipeline.handle({
      message: msg,
      me: { id: 7, username: "openclaw_bot" },
      update: { update_id: 12, message: msg },
    } as unknown as Context);

    expect(recordMessageForReplyChain).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        message_id: 11,
        media_group_id: "album-before-question",
        caption: "Deployment diagram",
      }),
      { scope: "none" },
      7,
      "openclaw_bot",
    );
  });
});

describe("edited /ignore handling", () => {
  it("resumes a buffered album when an edited /ignore is denied", async () => {
    const settle = vi.fn(async () => false);
    const settleBufferedMessage = vi.fn(() => true);
    const authorizationGate =
      createDeferred<
        Awaited<ReturnType<TelegramHandlerAuthorization["authorizeInboundMessage"]>>
      >();
    const authorization = {
      authorizeInboundMessage: vi.fn(() => authorizationGate.promise),
    } as unknown as TelegramHandlerAuthorization;
    inboundProcessing.beginPendingBufferedMessageIgnore.mockReturnValueOnce({
      settle: settleBufferedMessage,
    });
    inboundProcessing.beginPendingMediaGroupIgnore.mockReturnValueOnce({ settle });
    const params = {
      accountId: "default",
      bot: { api: { getChat: vi.fn(), sendMessage: vi.fn() } },
      cfg: { commands: { native: true } },
      opts: { botInfo: { id: 7, username: "openclaw_bot" } },
      runtime: { error: vi.fn() },
      shouldSkipUpdate: () => false,
      telegramCfg: { commands: { native: true } },
    } as unknown as RegisterTelegramHandlerParams;
    const message = {
      recordMessageForReplyChain: vi.fn(),
      removeMessageFromReplyChain: vi.fn(),
    } as unknown as TelegramMessagePipeline;
    const pipeline = createTelegramInboundPipeline({ params, message, authorization });
    const msg = {
      chat: { id: 42, type: "private" },
      message_id: 12,
      date: 1_736_371_600,
      edit_date: 1_736_371_610,
      media_group_id: "album-1",
      from: { id: 9, is_bot: false, first_name: "Ada" },
      text: "/ignore hidden",
      entities: [{ type: "bot_command", offset: 0, length: 7 }],
    } as Message;
    const pending = pipeline.handle({
      editedMessage: msg,
      me: { id: 7, username: "openclaw_bot" },
      update: { update_id: 13, edited_message: msg },
    } as unknown as Context);
    await vi.waitFor(() => expect(authorization.authorizeInboundMessage).toHaveBeenCalledOnce());
    expect(inboundProcessing.beginPendingMediaGroupIgnore).toHaveBeenCalledWith(msg);
    expect(inboundProcessing.beginPendingBufferedMessageIgnore).toHaveBeenCalledWith(msg);
    expect(settle).not.toHaveBeenCalled();
    expect(settleBufferedMessage).not.toHaveBeenCalled();

    authorizationGate.resolve({ allowed: false } as Awaited<
      ReturnType<TelegramHandlerAuthorization["authorizeInboundMessage"]>
    >);
    await pending;

    expect(settle).toHaveBeenCalledExactlyOnceWith(false);
    expect(settleBufferedMessage).toHaveBeenCalledExactlyOnceWith(false);
    expect(message.removeMessageFromReplyChain).not.toHaveBeenCalled();
  });

  it("persists a tombstone for the first ignored album member without a buffered owner", async () => {
    inboundProcessing.beginPendingBufferedMessageIgnore.mockReset();
    inboundProcessing.beginPendingMediaGroupIgnore.mockReset();
    const settle = vi.fn(async () => false);
    inboundProcessing.beginPendingMediaGroupIgnore.mockReturnValueOnce({ settle });
    const authorization = {
      authorizeInboundMessage: vi.fn(async () => ({
        allowed: true,
        context: { threadSpec: { scope: "none" } },
      })),
    } as unknown as TelegramHandlerAuthorization;
    const params = {
      accountId: "default",
      bot: { api: { getChat: vi.fn(), sendMessage: vi.fn() } },
      cfg: { commands: { native: true } },
      opts: { botInfo: { id: 7, username: "openclaw_bot" } },
      runtime: { error: vi.fn() },
      shouldSkipUpdate: () => false,
      telegramCfg: { commands: { native: true } },
    } as unknown as RegisterTelegramHandlerParams;
    const removeMessageFromReplyChain = vi.fn(async () => true);
    const message = {
      buildSyntheticContext: (ctx: Context, syntheticMessage: Message) =>
        Object.assign(ctx, { message: syntheticMessage }),
      releaseDispatchDedupeClaims: vi.fn(),
      recordMessageForReplyChain: vi.fn(),
      removeMessageFromReplyChain,
    } as unknown as TelegramMessagePipeline;
    const pipeline = createTelegramInboundPipeline({ params, message, authorization });
    const msg = {
      chat: { id: 42, type: "private", first_name: "Ada" },
      message_id: 13,
      date: 1_736_371_600,
      media_group_id: "album-first-ignore",
      from: { id: 9, is_bot: false, first_name: "Ada" },
      caption: "/ignore hidden",
      caption_entities: [{ type: "bot_command", offset: 0, length: 7 }],
      photo: [{ file_id: "p1", file_unique_id: "u1", width: 1, height: 1 }],
    } as Message;

    await pipeline.handle({
      message: msg,
      me: { id: 7, username: "openclaw_bot" },
      update: { update_id: 14, message: msg },
    } as unknown as Context);

    expect(settle).toHaveBeenCalledExactlyOnceWith(true);
    expect(removeMessageFromReplyChain).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ message_id: 13, media_group_id: "album-first-ignore" }),
    );
  });

  it("persists a tombstone for an initial non-album /ignore", async () => {
    inboundProcessing.beginPendingBufferedMessageIgnore.mockReset();
    inboundProcessing.beginPendingMediaGroupIgnore.mockReset();
    inboundProcessing.processInboundMessage.mockReset();
    const authorization = {
      authorizeInboundMessage: vi.fn(async () => ({
        allowed: true,
        context: { threadSpec: { scope: "none" } },
      })),
    } as unknown as TelegramHandlerAuthorization;
    const params = {
      accountId: "default",
      bot: { api: { getChat: vi.fn(), sendMessage: vi.fn() } },
      cfg: { commands: { native: true } },
      opts: { botInfo: { id: 7, username: "openclaw_bot" } },
      runtime: { error: vi.fn() },
      shouldSkipUpdate: () => false,
      telegramCfg: { commands: { native: true } },
    } as unknown as RegisterTelegramHandlerParams;
    const removeMessageFromReplyChain = vi.fn(async () => true);
    const message = {
      buildSyntheticContext: (ctx: Context, syntheticMessage: Message) =>
        Object.assign(ctx, { message: syntheticMessage }),
      recordMessageForReplyChain: vi.fn(),
      removeMessageFromReplyChain,
    } as unknown as TelegramMessagePipeline;
    const pipeline = createTelegramInboundPipeline({ params, message, authorization });
    const msg = {
      chat: { id: 42, type: "private", first_name: "Ada" },
      message_id: 14,
      date: 1_736_371_600,
      from: { id: 9, is_bot: false, first_name: "Ada" },
      text: "/ignore hidden",
      entities: [{ type: "bot_command", offset: 0, length: 7 }],
    } as Message;

    await pipeline.handle({
      message: msg,
      me: { id: 7, username: "openclaw_bot" },
      update: { update_id: 15, message: msg },
    } as unknown as Context);

    expect(removeMessageFromReplyChain).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ message_id: 14 }),
    );
    expect(inboundProcessing.processInboundMessage).not.toHaveBeenCalled();
  });

  it("keeps edited /ignore content when a plugin-native command owns it", async () => {
    inboundProcessing.beginPendingBufferedMessageIgnore.mockReset();
    inboundProcessing.beginPendingMediaGroupIgnore.mockReset();
    const authorization = {
      authorizeInboundMessage: vi.fn(async () => ({
        allowed: true,
        context: { threadSpec: { scope: "none" } },
      })),
    } as unknown as TelegramHandlerAuthorization;
    const params = {
      accountId: "default",
      bot: { api: { getChat: vi.fn(), sendMessage: vi.fn() } },
      cfg: { commands: { native: true } },
      opts: { botInfo: { id: 7, username: "openclaw_bot" } },
      pluginNativeCommandNames: new Set(["ignore"]),
      runtime: { error: vi.fn() },
      shouldSkipUpdate: () => false,
      telegramCfg: { commands: { native: true } },
    } as unknown as RegisterTelegramHandlerParams;
    const recordMessageForReplyChain = vi.fn(async () => undefined);
    const removeMessageFromReplyChain = vi.fn(async () => true);
    const message = {
      isMessageIgnoredForReplyChain: vi.fn(async () => false),
      recordMessageForReplyChain,
      removeMessageFromReplyChain,
    } as unknown as TelegramMessagePipeline;
    const pipeline = createTelegramInboundPipeline({ params, message, authorization });
    const msg = {
      chat: { id: 42, type: "private", first_name: "Ada" },
      message_id: 15,
      date: 1_736_371_600,
      edit_date: 1_736_371_610,
      from: { id: 9, is_bot: false, first_name: "Ada" },
      text: "/ignore plugin workflow input",
      entities: [{ type: "bot_command", offset: 0, length: 7 }],
    } as Message;

    await pipeline.handle({
      editedMessage: msg,
      me: { id: 7, username: "openclaw_bot" },
      update: { update_id: 16, edited_message: msg },
    } as unknown as Context);

    expect(recordMessageForReplyChain).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ message_id: 15, text: "/ignore plugin workflow input" }),
      { scope: "none" },
      7,
      "openclaw_bot",
    );
    expect(inboundProcessing.beginPendingBufferedMessageIgnore).not.toHaveBeenCalled();
    expect(inboundProcessing.beginPendingMediaGroupIgnore).not.toHaveBeenCalled();
    expect(removeMessageFromReplyChain).not.toHaveBeenCalled();
  });
});
