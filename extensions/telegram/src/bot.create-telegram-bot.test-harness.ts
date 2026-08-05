// Telegram plugin module implements bot.create telegram bot harness behavior.
import { existsSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { buildChannelInboundEventContext } from "openclaw/plugin-sdk/channel-inbound";
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-contracts";
import type { MockFn } from "openclaw/plugin-sdk/plugin-test-runtime";
import type { GetReplyOptions, MsgContext } from "openclaw/plugin-sdk/reply-runtime";
import { beforeEach, vi } from "vitest";
import type { TelegramBotDeps } from "./bot-deps.js";

type AnyMock = ReturnType<typeof vi.fn>;
type AnyAsyncMock = ReturnType<typeof vi.fn<(...args: unknown[]) => Promise<unknown>>>;
type GetRuntimeConfigFn =
  typeof import("openclaw/plugin-sdk/runtime-config-snapshot").getRuntimeConfig;
type GetSessionEntryFn = typeof import("openclaw/plugin-sdk/session-store-runtime").getSessionEntry;
type ListSessionEntriesFn =
  typeof import("openclaw/plugin-sdk/session-store-runtime").listSessionEntries;
type LoadSessionStoreFn =
  typeof import("openclaw/plugin-sdk/session-store-runtime").loadSessionStore;
type ResolveStorePathFn =
  typeof import("openclaw/plugin-sdk/session-store-runtime").resolveStorePath;
type ReadSessionUpdatedAtFn =
  typeof import("openclaw/plugin-sdk/session-store-runtime").readSessionUpdatedAt;
type SessionStore = ReturnType<LoadSessionStoreFn>;
type TelegramBotRuntimeForTest = NonNullable<
  Parameters<typeof import("./bot.js").setTelegramBotRuntimeForTest>[0]
>;
type DispatchReplyWithBufferedBlockDispatcherFn =
  typeof import("openclaw/plugin-sdk/reply-dispatch-runtime").dispatchReplyWithBufferedBlockDispatcher;
type DispatchReplyWithBufferedBlockDispatcherResult = Awaited<
  ReturnType<DispatchReplyWithBufferedBlockDispatcherFn>
>;
type DispatchReplyHarnessParams = Parameters<DispatchReplyWithBufferedBlockDispatcherFn>[0];
type ReplyPayloadLike = {
  text?: string;
  mediaUrl?: string;
  mediaUrls?: string[];
  replyToId?: string;
};

const { sessionStorePath } = vi.hoisted(() => {
  const tempRoot =
    process.platform === "win32"
      ? (process.env.TEMP ?? process.env.TMP ?? "C:\\Windows\\Temp")
      : (process.env.TMPDIR ?? "/tmp");
  const separator = process.platform === "win32" ? "\\" : "/";
  return {
    sessionStorePath: `${tempRoot.replace(/[\\/]+$/u, "")}${separator}openclaw-telegram-${
      process.pid
    }-${process.env.VITEST_POOL_ID ?? "0"}.json`,
  };
});

const { loadWebMedia } = vi.hoisted((): { loadWebMedia: AnyMock } => ({
  loadWebMedia: vi.fn(),
}));

export function getLoadWebMediaMock(): AnyMock {
  return loadWebMedia;
}

vi.mock("openclaw/plugin-sdk/web-media", () => ({
  loadWebMedia,
}));

const {
  getSessionEntryMock,
  getRuntimeConfig,
  listSessionEntriesMock,
  loadSessionStoreMock,
  readSessionUpdatedAtMock,
  recordInboundSessionMock,
  resolveStorePathMock,
  sessionStoreEntries,
} = vi.hoisted(
  (): {
    getSessionEntryMock: MockFn<GetSessionEntryFn>;
    getRuntimeConfig: MockFn<GetRuntimeConfigFn>;
    listSessionEntriesMock: MockFn<ListSessionEntriesFn>;
    loadSessionStoreMock: MockFn<LoadSessionStoreFn>;
    readSessionUpdatedAtMock: MockFn<ReadSessionUpdatedAtFn>;
    recordInboundSessionMock: MockFn<NonNullable<TelegramBotDeps["recordInboundSession"]>>;
    resolveStorePathMock: MockFn<ResolveStorePathFn>;
    sessionStoreEntries: { value: SessionStore };
  } => ({
    getRuntimeConfig: vi.fn<GetRuntimeConfigFn>(() => ({})),
    resolveStorePathMock: vi.fn<ResolveStorePathFn>(
      (storePath?: string) => storePath ?? sessionStorePath,
    ),
    loadSessionStoreMock: vi.fn<LoadSessionStoreFn>(
      (_storePath, _opts) => sessionStoreEntries.value,
    ),
    getSessionEntryMock: vi.fn<GetSessionEntryFn>(({ storePath, sessionKey, agentId }) => {
      const resolvedStorePath = storePath ?? resolveStorePathMock(undefined, { agentId });
      return loadSessionStoreMock(resolvedStorePath)[sessionKey];
    }),
    listSessionEntriesMock: vi.fn<ListSessionEntriesFn>(({ storePath, agentId } = {}) => {
      const resolvedStorePath = storePath ?? resolveStorePathMock(undefined, { agentId });
      return Object.entries(loadSessionStoreMock(resolvedStorePath)).map(([sessionKey, entry]) => ({
        sessionKey,
        entry,
      }));
    }),
    readSessionUpdatedAtMock: vi.fn<ReadSessionUpdatedAtFn>(() => undefined),
    recordInboundSessionMock: vi.fn(async () => undefined),
    sessionStoreEntries: { value: {} as SessionStore },
  }),
);

export function getLoadConfigMock(): AnyMock {
  return getRuntimeConfig;
}

export function getLoadSessionStoreMock(): AnyMock {
  return loadSessionStoreMock;
}

export function setSessionStoreEntriesForTest(entries: SessionStore) {
  sessionStoreEntries.value = structuredClone(entries);
}

const { readChannelAllowFromStore, upsertChannelPairingRequest } = vi.hoisted(
  (): {
    readChannelAllowFromStore: MockFn<TelegramBotDeps["readChannelAllowFromStore"]>;
    upsertChannelPairingRequest: MockFn<TelegramBotDeps["upsertChannelPairingRequest"]>;
  } => ({
    readChannelAllowFromStore: vi.fn(async () => [] as string[]),
    upsertChannelPairingRequest: vi.fn(async () => ({
      code: "PAIRCODE",
      created: true,
    })),
  }),
);

export function getReadChannelAllowFromStoreMock(): MockFn<
  TelegramBotDeps["readChannelAllowFromStore"]
> {
  return readChannelAllowFromStore;
}

export function getUpsertChannelPairingRequestMock(): MockFn<
  TelegramBotDeps["upsertChannelPairingRequest"]
> {
  return upsertChannelPairingRequest;
}

const skillCommandListHoisted = vi.hoisted(() => ({
  listSkillCommandsForAgents: vi.fn(() => []),
}));
const modelProviderDataHoisted = vi.hoisted(
  (): { buildModelsProviderData: MockFn<TelegramBotDeps["buildModelsProviderData"]> } => ({
    buildModelsProviderData: vi.fn(),
  }),
);
const replySpyHoisted = vi.hoisted(() => ({
  replySpy: vi.fn(async (_ctx: MsgContext, opts?: GetReplyOptions) => {
    await opts?.onReplyStart?.();
    return undefined;
  }) as MockFn<
    (
      ctx: MsgContext,
      opts?: GetReplyOptions,
      configOverride?: OpenClawConfig,
    ) => Promise<ReplyPayloadLike | ReplyPayloadLike[] | undefined>
  >,
}));

async function dispatchHarnessReplies(
  params: DispatchReplyHarnessParams,
  runReply: (
    params: DispatchReplyHarnessParams,
  ) => Promise<ReplyPayloadLike | ReplyPayloadLike[] | undefined>,
): Promise<DispatchReplyWithBufferedBlockDispatcherResult> {
  await params.dispatcherOptions.typingCallbacks?.onReplyStart?.();
  const reply = await runReply(params);
  const payloads: ReplyPayloadLike[] =
    reply === undefined ? [] : Array.isArray(reply) ? reply : [reply];
  let finalCount = 0;
  for (const payload of payloads) {
    const text =
      typeof payload.text === "string" &&
      params.dispatcherOptions.responsePrefix &&
      !payload.text.startsWith(params.dispatcherOptions.responsePrefix)
        ? `${params.dispatcherOptions.responsePrefix} ${payload.text}`
        : payload.text;
    const finalPayload = text === payload.text ? payload : { ...payload, text };
    try {
      await params.dispatcherOptions.deliver?.(finalPayload, { kind: "final" });
      finalCount += 1;
    } catch (err) {
      void params.dispatcherOptions.onError?.(err, { kind: "final" });
    }
  }
  return {
    queuedFinal: finalCount > 0,
    counts: {
      block: 0,
      final: finalCount,
      tool: 0,
    },
  };
}

const dispatchReplyHoisted = vi.hoisted(() => ({
  dispatchReplyWithBufferedBlockDispatcher: vi.fn<DispatchReplyWithBufferedBlockDispatcherFn>(
    async (params: DispatchReplyHarnessParams) =>
      await dispatchHarnessReplies(params, async (dispatchParams) => {
        return await replySpyHoisted.replySpy(dispatchParams.ctx, dispatchParams.replyOptions);
      }),
  ),
}));
export const listSkillCommandsForAgents = skillCommandListHoisted.listSkillCommandsForAgents;
const buildModelsProviderData = modelProviderDataHoisted.buildModelsProviderData;
export const replySpy = replySpyHoisted.replySpy;
export const dispatchReplyWithBufferedBlockDispatcher =
  dispatchReplyHoisted.dispatchReplyWithBufferedBlockDispatcher;
const menuSyncHoisted = vi.hoisted(() => ({
  syncTelegramMenuCommands: vi.fn(async ({ bot, commandsToRegister }) => {
    await bot.api.setMyCommands(commandsToRegister);
  }),
}));
export const syncTelegramMenuCommands = menuSyncHoisted.syncTelegramMenuCommands;

function parseModelRef(raw: string): { provider?: string; model: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { model: "" };
  }
  const slashIndex = trimmed.indexOf("/");
  if (slashIndex > 0 && slashIndex < trimmed.length - 1) {
    return {
      provider: trimmed.slice(0, slashIndex),
      model: trimmed.slice(slashIndex + 1),
    };
  }
  return { model: trimmed };
}

function normalizeLowercaseStringOrEmptyForTest(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function resolveDefaultModelForAgentForTest(params: { cfg: OpenClawConfig }): {
  provider: string;
  model: string;
} {
  const modelConfig = params.cfg.agents?.defaults?.model;
  const rawModel =
    typeof modelConfig === "string" ? modelConfig : (modelConfig?.primary ?? "openai/gpt-5.4");
  const parsed = parseModelRef(rawModel);
  const provider = normalizeLowercaseStringOrEmptyForTest(parsed.provider) || "openai";
  return {
    provider: provider === "bedrock" ? "amazon-bedrock" : provider,
    model: parsed.model || "gpt-5.4",
  };
}

function createModelsProviderDataFromConfig(cfg: OpenClawConfig): {
  byProvider: Map<string, Set<string>>;
  providers: string[];
  resolvedDefault: { provider: string; model: string };
  modelNames: Map<string, string>;
} {
  const byProvider = new Map<string, Set<string>>();
  const add = (providerRaw: string | undefined, modelRaw: string | undefined) => {
    const provider = normalizeLowercaseStringOrEmptyForTest(providerRaw);
    const model = modelRaw?.trim();
    if (!provider || !model) {
      return;
    }
    const existing = byProvider.get(provider) ?? new Set<string>();
    existing.add(model);
    byProvider.set(provider, existing);
  };

  const resolvedDefault = resolveDefaultModelForAgentForTest({ cfg });
  add(resolvedDefault.provider, resolvedDefault.model);

  for (const raw of Object.keys(cfg.agents?.defaults?.models ?? {})) {
    const parsed = parseModelRef(raw);
    add(parsed.provider ?? resolvedDefault.provider, parsed.model);
  }

  const providers = [...byProvider.keys()].toSorted();
  return { byProvider, providers, resolvedDefault, modelNames: new Map<string, string>() };
}

const systemEventsHoisted = vi.hoisted(() => ({
  enqueueSystemEventSpy: vi.fn<TelegramBotDeps["enqueueSystemEvent"]>(() => false),
}));
export const enqueueSystemEventSpy: MockFn<TelegramBotDeps["enqueueSystemEvent"]> =
  systemEventsHoisted.enqueueSystemEventSpy;
const execApprovalHoisted = vi.hoisted(() => ({
  resolveExecApprovalSpy: vi.fn(async () => undefined),
}));
export const resolveExecApprovalSpy = execApprovalHoisted.resolveExecApprovalSpy;

const sentMessageCacheHoisted = vi.hoisted(() => ({
  wasSentByBot: vi.fn(() => false),
}));
export const wasSentByBot = sentMessageCacheHoisted.wasSentByBot;

vi.doMock("./sent-message-cache.js", () => ({
  wasSentByBot: sentMessageCacheHoisted.wasSentByBot,
  recordSentMessage: vi.fn(),
  clearSentMessageCache: vi.fn(),
}));

// All spy variables used inside vi.mock("grammy", ...) must be created via
// vi.hoisted() so they are available when the hoisted factory runs, regardless
// of module evaluation order across different test files.
const grammySpies = vi.hoisted(() => ({
  useSpy: vi.fn() as MockFn<(arg: unknown) => void>,
  middlewareUseSpy: vi.fn(),
  onSpy: vi.fn(),
  stopSpy: vi.fn(),
  commandSpy: vi.fn(),
  botCtorSpy: vi.fn(
    (_: string, __?: { client?: { fetch?: typeof fetch }; botInfo?: unknown }) => undefined,
  ),
  answerCallbackQuerySpy: vi.fn(async () => undefined) as AnyAsyncMock,
  sendChatActionSpy: vi.fn(),
  editMessageTextSpy: vi.fn(async () => ({ message_id: 88 })) as AnyAsyncMock,
  editMessageReplyMarkupSpy: vi.fn(async () => ({ message_id: 88 })) as AnyAsyncMock,
  deleteMessageSpy: vi.fn(async () => true) as AnyAsyncMock,
  setMessageReactionSpy: vi.fn(async () => undefined) as AnyAsyncMock,
  setMyCommandsSpy: vi.fn(async () => undefined) as AnyAsyncMock,
  getMeSpy: vi.fn(async () => ({
    username: "openclaw_bot",
    has_topics_enabled: true,
  })) as AnyAsyncMock,
  getChatSpy: vi.fn(async () => undefined) as AnyAsyncMock,
  sendMessageSpy: vi.fn(async () => ({ message_id: 77 })) as AnyAsyncMock,
  sendAnimationSpy: vi.fn(async () => ({ message_id: 78 })) as AnyAsyncMock,
  sendPhotoSpy: vi.fn(async () => ({ message_id: 79 })) as AnyAsyncMock,
  getFileSpy: vi.fn(async () => ({ file_path: "media/file.jpg" })) as AnyAsyncMock,
}));

export const useSpy: MockFn<(arg: unknown) => void> = grammySpies.useSpy;
export const middlewareUseSpy: AnyMock = grammySpies.middlewareUseSpy;
export const onSpy: AnyMock = grammySpies.onSpy;
export const stopSpy: AnyMock = grammySpies.stopSpy;
export const commandSpy: AnyMock = grammySpies.commandSpy;
export const botCtorSpy: MockFn<
  (token: string, options?: { client?: { fetch?: typeof fetch }; botInfo?: unknown }) => void
> = grammySpies.botCtorSpy;
export const answerCallbackQuerySpy: AnyAsyncMock = grammySpies.answerCallbackQuerySpy;
export const sendChatActionSpy: AnyMock = grammySpies.sendChatActionSpy;
export const editMessageTextSpy: AnyAsyncMock = grammySpies.editMessageTextSpy;
export const editMessageReplyMarkupSpy: AnyAsyncMock = grammySpies.editMessageReplyMarkupSpy;
export const deleteMessageSpy: AnyAsyncMock = grammySpies.deleteMessageSpy;
export const setMessageReactionSpy: AnyAsyncMock = grammySpies.setMessageReactionSpy;
export const setMyCommandsSpy: AnyAsyncMock = grammySpies.setMyCommandsSpy;
export const getChatSpy: AnyAsyncMock = grammySpies.getChatSpy;
export const sendMessageSpy: AnyAsyncMock = grammySpies.sendMessageSpy;
export const sendAnimationSpy: AnyAsyncMock = grammySpies.sendAnimationSpy;
export const sendPhotoSpy: AnyAsyncMock = grammySpies.sendPhotoSpy;
export const getFileSpy: AnyAsyncMock = grammySpies.getFileSpy;

type RichMessageParams = {
  chat_id?: string | number;
  message_id?: number;
  rich_message?: {
    markdown?: string;
    html?: string;
  };
  [key: string]: unknown;
};

function getRichMessageText(params: RichMessageParams): string {
  return params.rich_message?.markdown ?? params.rich_message?.html ?? "";
}

function toLegacyMessageParams(params: RichMessageParams): Record<string, unknown> {
  const { chat_id: _chatId, message_id: _messageId, rich_message: _richMessage, ...rest } = params;
  const replyParameters = rest.reply_parameters;
  if (
    replyParameters &&
    typeof replyParameters === "object" &&
    !("quote" in replyParameters) &&
    typeof (replyParameters as { message_id?: unknown }).message_id === "number"
  ) {
    rest.reply_to_message_id = (replyParameters as { message_id: number }).message_id;
    rest.allow_sending_without_reply = true;
    delete rest.reply_parameters;
  }
  return rest;
}

const runnerHoisted = vi.hoisted(() => ({
  sequentializeMiddleware: vi.fn(async (_ctx: unknown, next?: () => Promise<void>) => {
    if (typeof next === "function") {
      await next();
    }
  }),
  sequentializeSpy: vi.fn(() => runnerHoisted.sequentializeMiddleware),
  throttlerSpy: vi.fn(() => "throttler"),
}));
export const sequentializeSpy: AnyMock = runnerHoisted.sequentializeSpy;
export let sequentializeKey: ((ctx: unknown) => string) | undefined;
export const throttlerSpy: AnyMock = runnerHoisted.throttlerSpy;
export const telegramBotRuntimeForTest: TelegramBotRuntimeForTest = {
  Bot: class {
    api = {
      config: { use: grammySpies.useSpy },
      answerCallbackQuery: grammySpies.answerCallbackQuerySpy,
      sendChatAction: grammySpies.sendChatActionSpy,
      editMessageText: grammySpies.editMessageTextSpy,
      editMessageReplyMarkup: grammySpies.editMessageReplyMarkupSpy,
      deleteMessage: grammySpies.deleteMessageSpy,
      setMessageReaction: grammySpies.setMessageReactionSpy,
      setMyCommands: grammySpies.setMyCommandsSpy,
      getMe: grammySpies.getMeSpy,
      getChat: grammySpies.getChatSpy,
      sendMessage: grammySpies.sendMessageSpy,
      sendAnimation: grammySpies.sendAnimationSpy,
      sendPhoto: grammySpies.sendPhotoSpy,
      getFile: grammySpies.getFileSpy,
      raw: {
        sendRichMessage: async (params: RichMessageParams) =>
          grammySpies.sendMessageSpy(
            params.chat_id,
            getRichMessageText(params),
            toLegacyMessageParams(params),
          ),
        editMessageText: async (params: RichMessageParams) =>
          grammySpies.editMessageTextSpy(
            params.chat_id,
            params.message_id,
            getRichMessageText(params),
            toLegacyMessageParams(params),
          ),
      },
    };
    use = grammySpies.middlewareUseSpy;
    on = grammySpies.onSpy;
    stop = grammySpies.stopSpy;
    command = grammySpies.commandSpy;
    catch = vi.fn();
    constructor(
      public token: string,
      public options?: { client?: { fetch?: typeof fetch }; botInfo?: unknown },
    ) {
      (grammySpies.botCtorSpy as unknown as (token: string, options?: unknown) => void)(
        token,
        options,
      );
    }
  } as unknown as TelegramBotRuntimeForTest["Bot"],
  sequentialize: ((keyFn: (ctx: unknown) => string) => {
    sequentializeKey = keyFn;
    return (
      runnerHoisted.sequentializeSpy as unknown as () => ReturnType<
        TelegramBotRuntimeForTest["sequentialize"]
      >
    )();
  }) as unknown as TelegramBotRuntimeForTest["sequentialize"],
  apiThrottler: (() =>
    (
      runnerHoisted.throttlerSpy as unknown as () => unknown
    )()) as unknown as TelegramBotRuntimeForTest["apiThrottler"],
};
export const telegramBotDepsForTest: TelegramBotDeps = {
  getRuntimeConfig,
  getSessionEntry: getSessionEntryMock,
  listSessionEntries: listSessionEntriesMock,
  loadSessionStore: loadSessionStoreMock as TelegramBotDeps["loadSessionStore"],
  resolveStorePath: resolveStorePathMock,
  readSessionUpdatedAt: readSessionUpdatedAtMock,
  recordInboundSession: recordInboundSessionMock as TelegramBotDeps["recordInboundSession"],
  recordChannelActivity: vi.fn() as TelegramBotDeps["recordChannelActivity"],
  resolveInboundLastRouteSessionKey: ({ route, sessionKey }) =>
    route.lastRoutePolicy === "main" ? route.mainSessionKey : sessionKey,
  resolvePinnedMainDmOwnerFromAllowlist: () => null,
  buildChannelInboundEventContext,
  readChannelAllowFromStore:
    readChannelAllowFromStore as TelegramBotDeps["readChannelAllowFromStore"],
  upsertChannelPairingRequest:
    upsertChannelPairingRequest as TelegramBotDeps["upsertChannelPairingRequest"],
  enqueueSystemEvent: enqueueSystemEventSpy as TelegramBotDeps["enqueueSystemEvent"],
  dispatchReplyWithBufferedBlockDispatcher,
  loadWebMedia: loadWebMedia as TelegramBotDeps["loadWebMedia"],
  buildModelsProviderData: buildModelsProviderData as TelegramBotDeps["buildModelsProviderData"],
  listSkillCommandsForAgents:
    listSkillCommandsForAgents as TelegramBotDeps["listSkillCommandsForAgents"],
  syncTelegramMenuCommands: syncTelegramMenuCommands as TelegramBotDeps["syncTelegramMenuCommands"],
  wasSentByBot: wasSentByBot as TelegramBotDeps["wasSentByBot"],
  resolveExecApproval: resolveExecApprovalSpy as NonNullable<
    TelegramBotDeps["resolveExecApproval"]
  >,
};

vi.doMock("./bot.runtime.js", () => telegramBotRuntimeForTest);

type RawIngressUpdate = {
  update_id: number;
  message?: Record<string, unknown>;
  edited_message?: Record<string, unknown>;
  channel_post?: Record<string, unknown>;
  edited_channel_post?: Record<string, unknown>;
};

type RawIngressMiddleware = (
  ctx: Record<string, unknown>,
  next: () => Promise<void>,
) => Promise<void>;

class RawIngressTestBot {
  private readonly middlewares: RawIngressMiddleware[] = [];
  private readonly middlewareCalls: number[] = [];
  private readonly handlers = new Map<
    string,
    Array<(ctx: Record<string, unknown>) => Promise<void>>
  >();
  private downstreamHandlerCalls = 0;

  api = {
    config: { use: grammySpies.useSpy },
    answerCallbackQuery: grammySpies.answerCallbackQuerySpy,
    sendChatAction: grammySpies.sendChatActionSpy,
    editMessageText: grammySpies.editMessageTextSpy,
    editMessageReplyMarkup: grammySpies.editMessageReplyMarkupSpy,
    deleteMessage: grammySpies.deleteMessageSpy,
    setMessageReaction: grammySpies.setMessageReactionSpy,
    setMyCommands: grammySpies.setMyCommandsSpy,
    getMe: grammySpies.getMeSpy,
    getChat: grammySpies.getChatSpy,
    sendMessage: grammySpies.sendMessageSpy,
    sendAnimation: grammySpies.sendAnimationSpy,
    sendPhoto: grammySpies.sendPhotoSpy,
    getFile: grammySpies.getFileSpy,
    raw: {
      sendRichMessage: async (params: RichMessageParams) =>
        grammySpies.sendMessageSpy(
          params.chat_id,
          getRichMessageText(params),
          toLegacyMessageParams(params),
        ),
      editMessageText: async (params: RichMessageParams) =>
        grammySpies.editMessageTextSpy(
          params.chat_id,
          params.message_id,
          getRichMessageText(params),
          toLegacyMessageParams(params),
        ),
    },
  };

  constructor(
    public token: string,
    public options?: { client?: { fetch?: typeof fetch }; botInfo?: unknown },
  ) {}

  use = (middleware: RawIngressMiddleware) => {
    this.middlewares.push(middleware);
    this.middlewareCalls.push(0);
    return this;
  };

  on = (event: string, handler: (ctx: Record<string, unknown>) => Promise<void>) => {
    const handlers = this.handlers.get(event) ?? [];
    handlers.push(handler);
    this.handlers.set(event, handlers);
    return this;
  };

  command = () => this;
  catch = () => this;
  stop = async () => undefined;

  callsAtMiddleware(index: number): number {
    return this.middlewareCalls[index] ?? 0;
  }

  callsAtDownstreamHandler(): number {
    return this.downstreamHandlerCalls;
  }

  async handleUpdate(update: RawIngressUpdate): Promise<void> {
    const payload =
      update.message ?? update.edited_message ?? update.channel_post ?? update.edited_channel_post;
    const ctx: Record<string, unknown> = {
      update,
      message: update.message,
      editedMessage: update.edited_message,
      channelPost: update.channel_post,
      editedChannelPost: update.edited_channel_post,
      chat: payload?.chat,
      from: payload?.from,
      me: {
        id: 777_000,
        is_bot: true,
        first_name: "Current",
        username:
          (this.options?.botInfo as { username?: string } | undefined)?.username ?? "CurrentBot",
      },
      api: this.api,
      getFile: async () => ({ download: async () => new Uint8Array() }),
      reply: async () => undefined,
    };
    const dispatch = async (index: number): Promise<void> => {
      const middleware = this.middlewares[index];
      if (middleware) {
        this.middlewareCalls[index] = (this.middlewareCalls[index] ?? 0) + 1;
        await middleware(ctx, async () => await dispatch(index + 1));
        return;
      }
      const event = update.message
        ? "message"
        : update.edited_message
          ? "edited_message"
          : update.channel_post
            ? "channel_post"
            : "edited_channel_post";
      for (const handler of this.handlers.get(event) ?? []) {
        this.downstreamHandlerCalls += 1;
        await handler(ctx);
      }
    };
    await dispatch(0);
  }
}

export async function createRawTelegramUpdateIngressHarnessForTest(params: {
  stateDir: string;
  config: OpenClawConfig;
  accountId: string;
  botUsername: string;
}) {
  // Reserved for future persistence-backed assertions; this narrowed harness
  // currently observes only real middleware boundaries.
  void params.stateDir;
  const rawIngressBotCore = await import("./bot-core.js");
  const { runWithTelegramSpooledReplayUpdate } = await import("./bot-processing-outcome.js");
  const watermarkWrite = vi.fn();
  let resolvePersistence!: () => void;
  const persistenceIdle = new Promise<void>((resolve) => {
    resolvePersistence = resolve;
  });
  rawIngressBotCore.setTelegramBotRuntimeForTest({
    Bot: RawIngressTestBot as unknown as TelegramBotRuntimeForTest["Bot"],
    sequentialize: ((_keyFn: (ctx: unknown) => string) => {
      return async (_ctx: unknown, next: () => Promise<void>) => await next();
    }) as unknown as TelegramBotRuntimeForTest["sequentialize"],
    apiThrottler: (() => () => undefined) as unknown as TelegramBotRuntimeForTest["apiThrottler"],
  });
  const bot = rawIngressBotCore.createTelegramBotCore({
    token: "test-token",
    accountId: params.accountId,
    config: params.config,
    botInfo: {
      id: 777_000,
      is_bot: true,
      first_name: "Current",
      username: params.botUsername,
      can_join_groups: true,
      can_read_all_group_messages: true,
      supports_inline_queries: false,
    },
    updateOffset: {
      onUpdateId: (updateId) => {
        watermarkWrite(updateId);
        resolvePersistence();
      },
    },
    telegramDeps: telegramBotDepsForTest,
  }) as unknown as RawIngressTestBot;
  const watermarkBaseline = watermarkWrite.mock.calls.length;

  return {
    handleLiveUpdate: async (update: RawIngressUpdate) => await bot.handleUpdate(update),
    handleSpooledReplayUpdate: async (update: RawIngressUpdate) => {
      await runWithTelegramSpooledReplayUpdate(update, async () => await bot.handleUpdate(update));
    },
    awaitPersistenceIdle: async () => await persistenceIdle,
    dispose: async () => {
      await bot.stop();
      rawIngressBotCore.setTelegramBotRuntimeForTest(undefined);
    },
    observers: {
      updateWatermarkWrite: {
        calls: () => watermarkWrite.mock.calls.length - watermarkBaseline,
      },
      // Registration order in bot-core is tracker, callback, then sequentialize.
      callbackMiddleware: { calls: () => bot.callsAtMiddleware(1) },
      sequentialize: { calls: () => bot.callsAtMiddleware(2) },
      downstreamHandler: { calls: () => bot.callsAtDownstreamHandler() },
    },
  };
}

export const getOnHandler = (event: string) => {
  const handler = onSpy.mock.calls.find((call) => call[0] === event)?.[1];
  if (!handler) {
    throw new Error(`Missing handler for event: ${event}`);
  }
  return handler as (ctx: Record<string, unknown>) => Promise<void>;
};

const DEFAULT_TELEGRAM_TEST_CONFIG: OpenClawConfig = {
  agents: {
    defaults: {
      envelopeTimezone: "utc",
    },
  },
  channels: {
    telegram: { dmPolicy: "open", allowFrom: ["*"] },
  },
};

function makeTelegramMessageCtx(params: {
  chat: {
    id: number;
    type: string;
    title?: string;
    is_forum?: boolean;
  };
  from: { id: number; username?: string };
  text: string;
  date?: number;
  messageId?: number;
  messageThreadId?: number;
}) {
  return {
    message: {
      chat: params.chat,
      from: params.from,
      text: params.text,
      date: params.date ?? 1736380800,
      message_id: params.messageId ?? 42,
      ...(params.messageThreadId === undefined
        ? {}
        : { message_thread_id: params.messageThreadId }),
    },
    me: { username: "openclaw_bot" },
    getFile: async () => ({ download: async () => new Uint8Array() }),
  };
}

export function makeForumGroupMessageCtx(params?: {
  chatId?: number;
  threadId?: number;
  text?: string;
  fromId?: number;
  username?: string;
  title?: string;
}) {
  return makeTelegramMessageCtx({
    chat: {
      id: params?.chatId ?? -1001234567890,
      type: "supergroup",
      title: params?.title ?? "Forum Group",
      is_forum: true,
    },
    from: { id: params?.fromId ?? 12345, username: params?.username ?? "testuser" },
    text: params?.text ?? "hello",
    messageThreadId: params?.threadId,
  });
}

function clearTelegramDispatchDedupeFilesForTest(): void {
  const dir = path.dirname(sessionStorePath);
  if (!existsSync(dir)) {
    return;
  }
  const prefix = `${path.basename(sessionStorePath)}.telegram-message-dispatch-`;
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(prefix)) {
      rmSync(path.join(dir, entry), { force: true });
    }
  }
}

beforeEach(() => {
  getRuntimeConfig.mockReset();
  getRuntimeConfig.mockReturnValue(DEFAULT_TELEGRAM_TEST_CONFIG);
  sessionStoreEntries.value = {};
  rmSync(`${sessionStorePath}.telegram-messages.json`, { force: true });
  clearTelegramDispatchDedupeFilesForTest();
  loadSessionStoreMock.mockReset();
  loadSessionStoreMock.mockImplementation(() => sessionStoreEntries.value);
  resolveStorePathMock.mockReset();
  resolveStorePathMock.mockImplementation((storePath?: string) => storePath ?? sessionStorePath);
  getSessionEntryMock.mockReset();
  getSessionEntryMock.mockImplementation(({ storePath, sessionKey, agentId }) => {
    const resolvedStorePath = storePath ?? resolveStorePathMock(undefined, { agentId });
    return loadSessionStoreMock(resolvedStorePath)[sessionKey];
  });
  listSessionEntriesMock.mockReset();
  listSessionEntriesMock.mockImplementation(({ storePath, agentId } = {}) => {
    const resolvedStorePath = storePath ?? resolveStorePathMock(undefined, { agentId });
    return Object.entries(loadSessionStoreMock(resolvedStorePath)).map(([sessionKey, entry]) => ({
      sessionKey,
      entry,
    }));
  });
  readSessionUpdatedAtMock.mockReset();
  readSessionUpdatedAtMock.mockReturnValue(undefined);
  recordInboundSessionMock.mockReset();
  recordInboundSessionMock.mockResolvedValue(undefined);
  loadWebMedia.mockReset();
  readChannelAllowFromStore.mockReset();
  readChannelAllowFromStore.mockResolvedValue([]);
  upsertChannelPairingRequest.mockReset();
  upsertChannelPairingRequest.mockResolvedValue({ code: "PAIRCODE", created: true } as const);
  onSpy.mockReset();
  commandSpy.mockReset();
  stopSpy.mockReset();
  useSpy.mockReset();
  replySpy.mockReset();
  replySpy.mockImplementation(async (_ctx: MsgContext, opts?: GetReplyOptions) => {
    await opts?.onReplyStart?.();
    return undefined;
  });
  resolveExecApprovalSpy.mockReset();
  resolveExecApprovalSpy.mockResolvedValue(undefined);
  dispatchReplyWithBufferedBlockDispatcher.mockReset();
  dispatchReplyWithBufferedBlockDispatcher.mockImplementation(
    async (params: DispatchReplyHarnessParams) =>
      await dispatchHarnessReplies(params, async (dispatchParams) => {
        return await replySpy(dispatchParams.ctx, dispatchParams.replyOptions);
      }),
  );
  syncTelegramMenuCommands.mockReset();
  syncTelegramMenuCommands.mockImplementation(async ({ bot, commandsToRegister }) => {
    await bot.api.setMyCommands(commandsToRegister);
  });

  sendAnimationSpy.mockReset();
  sendAnimationSpy.mockResolvedValue({ message_id: 78 });
  sendPhotoSpy.mockReset();
  sendPhotoSpy.mockResolvedValue({ message_id: 79 });
  sendMessageSpy.mockReset();
  sendMessageSpy.mockResolvedValue({ message_id: 77 });
  getFileSpy.mockReset();
  getFileSpy.mockResolvedValue({ file_path: "media/file.jpg" });

  setMessageReactionSpy.mockReset();
  setMessageReactionSpy.mockResolvedValue(undefined);
  answerCallbackQuerySpy.mockReset();
  answerCallbackQuerySpy.mockResolvedValue(undefined);
  sendChatActionSpy.mockReset();
  sendChatActionSpy.mockResolvedValue(undefined);
  setMyCommandsSpy.mockReset();
  setMyCommandsSpy.mockResolvedValue(undefined);
  getChatSpy.mockReset();
  getChatSpy.mockResolvedValue(undefined);
  grammySpies.getMeSpy.mockReset();
  grammySpies.getMeSpy.mockResolvedValue({
    username: "openclaw_bot",
    has_topics_enabled: true,
  });
  editMessageTextSpy.mockReset();
  editMessageTextSpy.mockResolvedValue({ message_id: 88 });
  editMessageReplyMarkupSpy.mockReset();
  editMessageReplyMarkupSpy.mockResolvedValue({ message_id: 88 });
  deleteMessageSpy.mockReset();
  deleteMessageSpy.mockResolvedValue(true);
  enqueueSystemEventSpy.mockReset();
  wasSentByBot.mockReset();
  wasSentByBot.mockReturnValue(false);
  listSkillCommandsForAgents.mockReset();
  listSkillCommandsForAgents.mockReturnValue([]);
  buildModelsProviderData.mockReset();
  buildModelsProviderData.mockImplementation(async (cfg: OpenClawConfig) => {
    return createModelsProviderDataFromConfig(cfg);
  });
  middlewareUseSpy.mockReset();
  runnerHoisted.sequentializeMiddleware.mockReset();
  runnerHoisted.sequentializeMiddleware.mockImplementation(async (_ctx, next) => {
    if (typeof next === "function") {
      await next();
    }
  });
  sequentializeSpy.mockReset();
  sequentializeSpy.mockImplementation(() => runnerHoisted.sequentializeMiddleware);
  botCtorSpy.mockReset();
  sequentializeKey = undefined;
});
