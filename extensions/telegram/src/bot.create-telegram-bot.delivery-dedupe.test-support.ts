import { questionGatewayRuntime } from "openclaw/plugin-sdk/question-gateway-runtime";
import { expect, it, vi } from "vitest";
import {
  answerCallbackQuerySpy,
  createTelegramBot,
  dispatchReplyWithBufferedBlockDispatcher,
  getOnHandler,
  loadConfig,
  middlewareUseSpy,
  replySpy,
  sendChatActionSpy,
} from "./bot.create-telegram-bot.ignore.test-support.js";
import { makeCallbackRetryContext } from "./bot.create-telegram-bot.test-support.js";
import { runTelegramTestMiddlewareChain, type TelegramTestContext } from "./bot.test-helpers.js";

export function registerTelegramDeliveryAndDedupeTests(): void {
  it("triggers typing cue via onReplyStart", async () => {
    dispatchReplyWithBufferedBlockDispatcher.mockImplementationOnce(
      async ({ dispatcherOptions }) => {
        await dispatcherOptions.typingCallbacks?.onReplyStart?.();
        return { queuedFinal: false, counts: { block: 0, final: 0, tool: 0 } };
      },
    );
    createTelegramBot({ token: "tok" });
    const handler = getOnHandler("message") as (ctx: Record<string, unknown>) => Promise<void>;
    await handler({
      message: {
        chat: { id: 42, type: "private" },
        from: { id: 999, username: "random" },
        text: "hi",
      },
      me: { username: "openclaw_bot" },
      getFile: async () => ({ download: async () => new Uint8Array() }),
    });
    expect(sendChatActionSpy).toHaveBeenCalledWith(42, "typing", undefined);
  });

  it("dedupes duplicate updates for callback_query, message, and channel_post", async () => {
    loadConfig.mockReturnValue({
      messages: { inbound: { debounceMs: 0 } },
      channels: {
        telegram: {
          dmPolicy: "open",
          allowFrom: ["*"],
          groupPolicy: "open",
          groups: {
            "-100777111222": {
              enabled: true,
              requireMention: false,
            },
          },
        },
      },
    });

    createTelegramBot({ token: "tok" });
    const callbackHandler = getOnHandler("callback_query") as (
      ctx: Record<string, unknown>,
    ) => Promise<void>;
    const messageHandler = getOnHandler("message") as (
      ctx: Record<string, unknown>,
    ) => Promise<void>;
    const channelPostHandler = getOnHandler("channel_post") as (
      ctx: Record<string, unknown>,
    ) => Promise<void>;

    const callbackCtx = (id: string, data: string) =>
      makeCallbackRetryContext({
        updateId: 222,
        id,
        data,
        messageId: 9001,
        from: { id: 789, username: "testuser" },
        message: { chat: { id: 123, type: "private" } },
      });
    const resolveQuestion = vi
      .spyOn(questionGatewayRuntime, "resolveOption")
      .mockRejectedValue(new Error("Unexpected duplicate question resolution"));
    try {
      await runTelegramTestMiddlewareChain(
        middlewareUseSpy,
        callbackCtx("cb-1", "ping"),
        async (ctx) => await callbackHandler(ctx as TelegramTestContext),
      );
      await callbackHandler(
        callbackCtx("cb-question-duplicate", "tgq1:ask_0123456789abcdef0123456789abcdef:1"),
      );
      expect(replySpy).toHaveBeenCalledTimes(1);
      expect(answerCallbackQuerySpy).toHaveBeenCalledWith("cb-question-duplicate");
      expect(resolveQuestion).not.toHaveBeenCalled();
    } finally {
      resolveQuestion.mockRestore();
    }

    replySpy.mockClear();

    await messageHandler({
      update: { update_id: 111 },
      message: {
        chat: { id: 123, type: "private" },
        from: { id: 456, username: "testuser" },
        text: "hello",
        date: 1736380800,
        message_id: 42,
      },
      me: { username: "openclaw_bot" },
      getFile: async () => ({ download: async () => new Uint8Array() }),
    });
    await messageHandler({
      update: { update_id: 111 },
      message: {
        chat: { id: 123, type: "private" },
        from: { id: 456, username: "testuser" },
        text: "hello",
        date: 1736380800,
        message_id: 42,
      },
      me: { username: "openclaw_bot" },
      getFile: async () => ({ download: async () => new Uint8Array() }),
    });
    expect(replySpy).toHaveBeenCalledTimes(1);

    replySpy.mockClear();

    await channelPostHandler({
      channelPost: {
        chat: { id: -100777111222, type: "channel", title: "Wake Channel" },
        from: { id: 98765, is_bot: true, first_name: "wakebot", username: "wake_bot" },
        message_id: 777,
        text: "wake check",
        date: 1736380800,
      },
      me: { username: "openclaw_bot" },
      getFile: async () => ({}),
    });
    await channelPostHandler({
      channelPost: {
        chat: { id: -100777111222, type: "channel", title: "Wake Channel" },
        from: { id: 98765, is_bot: true, first_name: "wakebot", username: "wake_bot" },
        message_id: 777,
        text: "wake check",
        date: 1736380800,
      },
      me: { username: "openclaw_bot" },
      getFile: async () => ({}),
    });
    expect(replySpy).toHaveBeenCalledTimes(1);
  });
}
