import type { Message } from "grammy/types";
import type { PluginStateKeyedStore } from "openclaw/plugin-sdk/plugin-state-runtime";
import { resolveTelegramPrimaryMedia } from "./bot/body-helpers.js";
import type { TelegramThreadSpec } from "./bot/helpers.js";
import {
  compareCachedMessageNodes,
  createTelegramMessageThreadBinding,
  isGroupMessage,
  isTelegramMessageFromCurrentBot,
  normalizeMessageNodes,
  parsePersistedCacheValue,
  parseRetainedCacheNode,
  parseSafeMessageId,
  persistedCacheNode,
  retainedMessageId,
  type TelegramCachedMessageNode,
} from "./message-cache-codec.js";
import {
  parseTelegramResolvedMedia,
  type PersistedTelegramMessageCacheValue,
  type PersistedTelegramMessagePrivacyEntry,
  type TelegramResolvedMedia,
  resolveTelegramMessageCachePersistentScopeKey,
  TELEGRAM_MESSAGE_CACHE_PERSISTENT_MAX_MESSAGES,
  TELEGRAM_MESSAGE_CACHE_PERSISTENT_NAMESPACE,
} from "./message-cache-persistence.js";
import { hydrateMessageCacheBucket } from "./message-cache.hydration.js";
import {
  detachIgnoredReplyTarget,
  readIgnoredMediaGroupIds,
  readIgnoredMessageIds,
  telegramIgnoredMediaGroupIdentity,
  telegramIgnoredMessageIdentity,
} from "./message-cache.privacy.js";
import { createTelegramMessageCacheRemoval } from "./message-cache.removal.js";
import {
  mergeRetainedCacheNode,
  persistCachedNode,
  resolveDefaultPersistentStore,
  resolveDefaultPrivacyStore,
  resolveMessageCacheBucket,
  runMessageCacheMutation,
  trimMessages,
  upsertCachedMessageNode,
} from "./message-cache.storage.js";
import { parseTelegramMessageThreadId } from "./outbound-params.js";
import type { TelegramPromptContextProjection } from "./prompt-context-projection.js";
import { getOptionalTelegramRuntime } from "./runtime.js";

export type { TelegramReplyChainEntry } from "./message-cache-codec.js";

export type TelegramMessageCache = {
  record: (params: {
    accountId: string;
    chatId: string | number;
    msg: Message;
    botUserId?: number;
    botUsername?: string;
    promptContextProjection?: TelegramPromptContextProjection;
    /** Set only while recording an authenticated provider event or response. */
    providerObservedThread?: TelegramThreadSpec;
    threadId?: number;
    historyEligible?: boolean;
  }) => Promise<TelegramCachedMessageNode>;
  recordResolvedMedia: (params: {
    accountId: string;
    botUserId?: number;
    chatId: string | number;
    messageId: string;
    media: TelegramResolvedMedia & { path?: string; fileName?: string };
  }) => Promise<void>;
  remove: (params: {
    accountId: string;
    chatId: string | number;
    messageId: string;
    mediaGroupId?: string;
  }) => Promise<boolean>;
  isIgnored: (params: {
    accountId: string;
    chatId: string | number;
    messageId: string;
    mediaGroupId?: string;
  }) => Promise<boolean>;
  get: (params: {
    accountId: string;
    chatId: string | number;
    messageId?: string;
  }) => Promise<TelegramCachedMessageNode | null>;
  recentBefore: (params: {
    accountId: string;
    chatId: string | number;
    messageId?: string;
    threadId?: number;
    limit: number;
  }) => Promise<TelegramCachedMessageNode[]>;
  around: (params: {
    accountId: string;
    chatId: string | number;
    messageId?: string;
    threadId?: number;
    before: number;
    after: number;
  }) => Promise<TelegramCachedMessageNode[]>;
  /** Reads at most `limit` raw records, before topic and history eligibility filtering. */
  readHistoryWindow: (params: {
    accountId: string;
    chatId: string | number;
    threadId?: number;
    before?: string;
    limit: number;
  }) => Promise<TelegramCachedMessageNode[]>;
  readHistory: (params: {
    accountId: string;
    chatId: string | number;
    threadId?: number;
    before?: string;
    after?: string;
    limit: number;
  }) => Promise<{ messages: TelegramCachedMessageNode[]; hasMore: boolean }>;
};

export type TelegramMessageCacheBucket = {
  messages: Map<string, TelegramCachedMessageNode>;
  hydrated: boolean;
  hydratePromise?: Promise<void>;
  persistentStore?: TelegramMessageCachePersistentStore;
  privacyStore?: TelegramMessagePrivacyPersistentStore;
  ignoredMessages: Set<string>;
  ignoredMediaGroups: Set<string>;
  privacyIdentities: Map<
    string,
    { kind: "ignored-message" | "ignored-media-group"; identity: string }
  >;
  promoted?: boolean;
  promotePromise?: Promise<void>;
  chatRetention?: Map<string, "bounded" | "retained">;
  mutationTails?: Map<string, Promise<void>>;
};

const DEFAULT_MAX_MESSAGES = 5000;
const PERSISTENT_BUCKET_KEY = `plugin-state:${TELEGRAM_MESSAGE_CACHE_PERSISTENT_NAMESPACE}`;

export type TelegramMessageCachePersistentStore = {
  register(key: string, value: PersistedTelegramMessageCacheValue): Promise<void>;
  lookup(key: string): Promise<PersistedTelegramMessageCacheValue | undefined>;
  delete(key: string): Promise<boolean>;
  entries(): Promise<Array<{ key: string; value: unknown }>>;
};

export type TelegramMessagePrivacyPersistentStore = {
  register(key: string, value: PersistedTelegramMessagePrivacyEntry): Promise<void>;
  lookup(key: string): Promise<PersistedTelegramMessagePrivacyEntry | undefined>;
  delete(key: string): Promise<boolean>;
  entries(): Promise<Array<{ key: string; value: unknown }>>;
};

export type TelegramMessageCacheRetainedStore = Required<
  Pick<
    PluginStateKeyedStore<PersistedTelegramMessageCacheValue>,
    "lookup" | "observe" | "compareAndApply" | "entriesInKeyRange" | "moveEntriesFrom"
  >
>;

const RETAINED_MESSAGE_PAGE_SIZE = 256;
const RETAINED_PROMOTION_BATCH_SIZE = 10_000;

function telegramMessageCacheKey(params: {
  scopeKey: string | undefined;
  accountId: string;
  chatId: string | number;
  messageId: string;
}) {
  const key = `${params.accountId}:${params.chatId}:${params.messageId}`;
  return params.scopeKey ? `${params.scopeKey}:${key}` : key;
}

function telegramMessageCacheKeyPrefix(params: {
  scopeKey: string | undefined;
  accountId: string;
  chatId: string | number;
}) {
  const prefix = `${params.accountId}:${params.chatId}:`;
  return params.scopeKey ? `${params.scopeKey}:${prefix}` : prefix;
}

export function createTelegramMessageCache(params?: {
  maxMessages?: number;
  scope?: string;
  persistentStore?: TelegramMessageCachePersistentStore;
  privacyStore?: TelegramMessagePrivacyPersistentStore;
  bucketKey?: string;
  botUsername?: string;
  ignoreEnabled?: boolean;
}): TelegramMessageCache {
  const botUsername = params?.botUsername;
  const ignoreEnabled = params?.ignoreEnabled !== false;
  // Custom bounded adapters and no-runtime construction retain their explicit memory-cache contract.
  const runtime = params?.persistentStore ? undefined : getOptionalTelegramRuntime();
  const hasRetainedStore = runtime != null;
  const persistentStore = params?.persistentStore ?? resolveDefaultPersistentStore();
  const privacyStore =
    params?.privacyStore ??
    resolveDefaultPrivacyStore({
      requiredForPersistentMessageCache: persistentStore !== undefined,
    });
  const maxMessages =
    params?.maxMessages ??
    (persistentStore ? TELEGRAM_MESSAGE_CACHE_PERSISTENT_MAX_MESSAGES : DEFAULT_MAX_MESSAGES);
  const scopeKey =
    persistentStore || privacyStore || hasRetainedStore
      ? resolveTelegramMessageCachePersistentScopeKey(params?.scope ?? "default")
      : undefined;
  const bucketKey =
    params?.bucketKey ??
    (persistentStore || privacyStore || hasRetainedStore
      ? `${PERSISTENT_BUCKET_KEY}:${scopeKey}`
      : undefined);
  const bucket = resolveMessageCacheBucket({
    bucketKey,
    ...(persistentStore ? { persistentStore } : {}),
    ...(privacyStore ? { privacyStore } : {}),
  });
  const { messages } = bucket;
  let retainedStore: TelegramMessageCacheRetainedStore | undefined;
  const chatRetention = (bucket.chatRetention ??= new Map<string, "bounded" | "retained">());

  const openRetainedStore = async (): Promise<TelegramMessageCacheRetainedStore> => {
    if (!retainedStore) {
      const store = runtime?.state.openKeyedStore<PersistedTelegramMessageCacheValue>({
        namespace: TELEGRAM_MESSAGE_CACHE_PERSISTENT_NAMESPACE,
        retention: "retained",
      });
      if (
        !store?.observe ||
        !store.compareAndApply ||
        !store.entriesInKeyRange ||
        !store.moveEntriesFrom
      ) {
        throw new Error("Telegram group history requires retained plugin-state support");
      }
      retainedStore = {
        lookup: (key) => store.lookup(key),
        observe: store.observe,
        compareAndApply: store.compareAndApply,
        entriesInKeyRange: store.entriesInKeyRange,
        moveEntriesFrom: store.moveEntriesFrom,
      };
    }
    const store = retainedStore;
    if (!bucket.promoted) {
      bucket.promotePromise ??= (async () => {
        if (!persistentStore) {
          throw new Error("Telegram group history cannot open the previous message cache");
        }
        const entries: Array<{ sourceKey: string; targetKey: string }> = [];
        for (const { key, value } of await persistentStore.entries()) {
          const node = parsePersistedCacheValue(key, value).at(-1)?.node;
          const id = node && retainedMessageId(node.messageId);
          if (!node || !id || !isGroupMessage(node.sourceMessage)) {
            continue;
          }
          const suffix = `:${node.sourceMessage.chat.id}:${node.messageId}`;
          if (!key.endsWith(suffix)) {
            continue;
          }
          entries.push({
            sourceKey: key,
            targetKey: `${key.slice(0, key.lastIndexOf(":") + 1)}${id}`,
          });
        }
        for (let offset = 0; offset < entries.length; offset += RETAINED_PROMOTION_BATCH_SIZE) {
          const batch = entries.slice(offset, offset + RETAINED_PROMOTION_BATCH_SIZE);
          await store.moveEntriesFrom({
            namespace: TELEGRAM_MESSAGE_CACHE_PERSISTENT_NAMESPACE,
            entries: batch,
          });
          for (const { sourceKey } of batch) {
            messages.delete(sourceKey);
          }
        }
        bucket.promoted = true;
      })().finally(() => {
        bucket.promotePromise = undefined;
      });
      await bucket.promotePromise;
    }
    return store;
  };

  const usesRetainedHistory = (accountId: string, chatId: string | number): boolean => {
    if (!hasRetainedStore) {
      return false;
    }
    const prefix = telegramMessageCacheKeyPrefix({ scopeKey, accountId, chatId });
    // Native private-chat IDs are positive. A DM read must not acquire group-history availability.
    const retention = chatRetention.get(prefix);
    return retention === "retained" || (retention === undefined && String(chatId).startsWith("-"));
  };

  const isIgnored: TelegramMessageCache["isIgnored"] = async ({
    accountId,
    chatId,
    messageId,
    mediaGroupId,
  }) => {
    await hydrateMessageCacheBucket(bucket, maxMessages, scopeKey, hasRetainedStore);
    if (
      bucket.ignoredMessages.has(telegramIgnoredMessageIdentity({ accountId, chatId, messageId }))
    ) {
      return true;
    }
    return mediaGroupId
      ? bucket.ignoredMediaGroups.has(
          telegramIgnoredMediaGroupIdentity({ accountId, chatId, mediaGroupId }),
        )
      : false;
  };

  const isNodeIgnored = (paramsLocal: {
    accountId: string;
    chatId: string | number;
    node: TelegramCachedMessageNode;
  }): boolean =>
    bucket.ignoredMessages.has(
      telegramIgnoredMessageIdentity({
        accountId: paramsLocal.accountId,
        chatId: paramsLocal.chatId,
        messageId: paramsLocal.node.messageId,
      }),
    ) ||
    (typeof paramsLocal.node.sourceMessage.media_group_id === "string" &&
      bucket.ignoredMediaGroups.has(
        telegramIgnoredMediaGroupIdentity({
          accountId: paramsLocal.accountId,
          chatId: paramsLocal.chatId,
          mediaGroupId: paramsLocal.node.sourceMessage.media_group_id,
        }),
      ));

  const get: TelegramMessageCache["get"] = async ({ accountId, chatId, messageId }) => {
    if (!messageId) {
      return null;
    }
    await hydrateMessageCacheBucket(bucket, maxMessages, scopeKey, hasRetainedStore);
    if (usesRetainedHistory(accountId, chatId)) {
      const id = retainedMessageId(messageId);
      if (!id) {
        return null;
      }
      const store = await openRetainedStore();
      const key = telegramMessageCacheKey({ scopeKey, accountId, chatId, messageId: id });
      const node = parseRetainedCacheNode(key, await store.lookup(key));
      return node && !isNodeIgnored({ accountId, chatId, node }) ? node : null;
    }
    const key = telegramMessageCacheKey({ scopeKey, accountId, chatId, messageId });
    const entry = messages.get(key);
    if (!entry || isNodeIgnored({ accountId, chatId, node: entry })) {
      return null;
    }
    messages.delete(key);
    messages.set(key, entry);
    return entry;
  };

  const readNodes = async (options: {
    accountId: string;
    chatId: string | number;
    threadId?: number;
    minId?: number;
    maxId?: number;
    limit: number;
    order: "asc" | "desc";
    historyOnly?: boolean;
    scanLimit?: number;
  }): Promise<TelegramCachedMessageNode[]> => {
    if (!Number.isSafeInteger(options.limit) || options.limit <= 0) {
      return [];
    }
    const normalizedThreadId = parseTelegramMessageThreadId(options.threadId);
    if (options.threadId !== undefined && normalizedThreadId === undefined) {
      return [];
    }
    const thread = normalizedThreadId === undefined ? undefined : String(normalizedThreadId);
    const minId = options.minId ?? 1;
    const maxId = options.maxId ?? 9_999_999_999;
    if (minId > maxId) {
      return [];
    }
    const matches = (node: TelegramCachedMessageNode) =>
      options.historyOnly
        ? node.historyEligible === true && node.threadId === thread
        : thread === undefined || node.threadId === thread;
    const prefix = telegramMessageCacheKeyPrefix({ scopeKey, ...options });
    await hydrateMessageCacheBucket(bucket, maxMessages, scopeKey, hasRetainedStore);
    if (usesRetainedHistory(options.accountId, options.chatId)) {
      const store = await openRetainedStore();
      let keyStartInclusive = `${prefix}${String(minId).padStart(10, "0")}`;
      let keyEndExclusive =
        maxId >= 9_999_999_999 ? `${prefix}~` : `${prefix}${String(maxId + 1).padStart(10, "0")}`;
      const selected: TelegramCachedMessageNode[] = [];
      let remaining = options.scanLimit ?? Number.POSITIVE_INFINITY;
      while (selected.length < options.limit && remaining > 0) {
        const pageLimit = Math.min(RETAINED_MESSAGE_PAGE_SIZE, remaining);
        const page = await store.entriesInKeyRange({
          keyStartInclusive,
          keyEndExclusive,
          limit: pageLimit,
          order: options.order,
        });
        remaining -= page.length;
        for (const { key, value } of page) {
          const node = parseRetainedCacheNode(key, value);
          if (
            node &&
            !isNodeIgnored({ accountId: options.accountId, chatId: options.chatId, node }) &&
            matches(node)
          ) {
            selected.push(node);
            if (selected.length === options.limit) {
              break;
            }
          }
        }
        if (page.length < pageLimit || selected.length === options.limit) {
          break;
        }
        const lastKey = page.at(-1)!.key;
        if (options.order === "desc") {
          keyEndExclusive = lastKey;
        } else {
          const nextId = Number(lastKey.slice(prefix.length)) + 1;
          if (!Number.isSafeInteger(nextId) || nextId > maxId) {
            break;
          }
          keyStartInclusive = `${prefix}${String(nextId).padStart(10, "0")}`;
        }
      }
      return selected;
    }
    const selected = Array.from(messages)
      .filter(([key, node]) => {
        const id = parseSafeMessageId(node.messageId);
        return (
          key.startsWith(prefix) &&
          !isNodeIgnored({ accountId: options.accountId, chatId: options.chatId, node }) &&
          id !== undefined &&
          id >= minId &&
          id <= maxId
        );
      })
      .map(([, node]) => node)
      .toSorted(compareCachedMessageNodes);
    const ordered = options.order === "asc" ? selected : selected.toReversed();
    return ordered.slice(0, options.scanLimit).filter(matches).slice(0, options.limit);
  };

  const remove = createTelegramMessageCacheRemoval({
    bucket,
    messages,
    scopeKey,
    hydrate: () => hydrateMessageCacheBucket(bucket, maxMessages, scopeKey, hasRetainedStore),
    usesRetainedHistory,
    openRetainedStore,
    runMutation: (accountId, chatId, mutate) =>
      runMessageCacheMutation({
        bucket,
        key: telegramMessageCacheKeyPrefix({ scopeKey, accountId, chatId }),
        mutate,
      }),
  });

  return {
    record: async ({
      accountId,
      botUserId,
      botUsername: observedBotUsername,
      chatId,
      msg,
      promptContextProjection,
      providerObservedThread,
      threadId,
      historyEligible,
    }) => {
      await hydrateMessageCacheBucket(bucket, maxMessages, scopeKey, hasRetainedStore);
      return runMessageCacheMutation({
        bucket,
        key: telegramMessageCacheKeyPrefix({ scopeKey, accountId, chatId }),
        mutate: async () => {
          const ignoredMessageIds = readIgnoredMessageIds({ bucket, accountId, chatId });
          const ignoredMediaGroupIds = readIgnoredMediaGroupIds({ bucket, accountId, chatId });
          const sanitizedMessage = detachIgnoredReplyTarget(
            msg,
            chatId,
            observedBotUsername ?? botUsername,
            ignoreEnabled,
            ignoredMessageIds,
            ignoredMediaGroupIds,
          );
          const retained = hasRetainedStore && isGroupMessage(sanitizedMessage);
          const store = retained ? await openRetainedStore() : undefined;
          const threadBinding = createTelegramMessageThreadBinding(providerObservedThread);
          const observations = normalizeMessageNodes(sanitizedMessage, {
            threadId,
            historyEligible,
            ...(promptContextProjection && isTelegramMessageFromCurrentBot(msg, botUserId)
              ? {
                  promptContextProjectionMarker: {
                    kind: "valid",
                    projection: promptContextProjection,
                  },
                }
              : {}),
            ...(threadBinding ? { threadBinding } : {}),
          });
          const currentObservation = observations.at(-1)!;
          let recordedEntry = currentObservation.node;
          for (const { node, mode } of observations) {
            const { messageId } = node;
            if (
              ignoredMessageIds.has(messageId) ||
              (typeof node.sourceMessage.media_group_id === "string" &&
                ignoredMediaGroupIds.has(node.sourceMessage.media_group_id))
            ) {
              continue;
            }
            if (store) {
              const id = retainedMessageId(messageId);
              if (!id || String(node.sourceMessage.chat?.id) !== String(chatId)) {
                throw new Error("Telegram history requires a native message ID in the owning chat");
              }
              const key = telegramMessageCacheKey({ scopeKey, accountId, chatId, messageId: id });
              const cachedNode = await mergeRetainedCacheNode({
                store,
                key,
                node,
                mode,
                botUserId,
              });
              if (cachedNode && messageId === currentObservation.node.messageId) {
                recordedEntry = cachedNode;
              }
              chatRetention.set(
                telegramMessageCacheKeyPrefix({ scopeKey, accountId, chatId }),
                "retained",
              );
            } else {
              const key = telegramMessageCacheKey({ scopeKey, accountId, chatId, messageId });
              chatRetention.set(
                telegramMessageCacheKeyPrefix({ scopeKey, accountId, chatId }),
                "bounded",
              );
              const cachedNode = upsertCachedMessageNode({ messages, key, node, mode });
              if (messageId === currentObservation.node.messageId) {
                recordedEntry = cachedNode;
              }
              trimMessages(messages, maxMessages);
              await persistCachedNode({
                bucket,
                key,
                node: cachedNode,
                botUserId,
                beforeWrite: hasRetainedStore && !bucket.promoted ? openRetainedStore : undefined,
              });
            }
          }
          return recordedEntry;
        },
      });
    },
    recordResolvedMedia: async ({ accountId, botUserId, chatId, messageId, media }) => {
      await hydrateMessageCacheBucket(bucket, maxMessages, scopeKey, hasRetainedStore);
      // Runtime downloads carry private paths/names; retain only the persisted media projection.
      const resolvedMedia = parseTelegramResolvedMedia(media);
      if (!resolvedMedia) {
        throw new Error(`Telegram message ${messageId} has invalid resolved media`);
      }
      const withMedia = (node: TelegramCachedMessageNode | null | undefined) => {
        if (!node) {
          throw new Error(`Telegram message ${messageId} was not recorded before media resolution`);
        }
        const fileUniqueId = resolveTelegramPrimaryMedia(node.sourceMessage)?.fileRef
          .file_unique_id;
        if (fileUniqueId !== resolvedMedia.fileUniqueId) {
          throw new Error(`Telegram message ${messageId} media changed during resolution`);
        }
        return { ...node, resolvedMedia };
      };
      if (usesRetainedHistory(accountId, chatId)) {
        const id = retainedMessageId(messageId);
        if (!id) {
          throw new Error("Telegram history requires a native message ID");
        }
        const store = await openRetainedStore();
        const key = telegramMessageCacheKey({ scopeKey, accountId, chatId, messageId: id });
        let observation = await store.observe(key);
        for (;;) {
          const node = withMedia(parseRetainedCacheNode(key, observation.value));
          const result = await store.compareAndApply(key, observation.comparison, {
            operation: "update",
            action: "set",
            value: persistedCacheNode(node, botUserId ?? observation.value?.botUserId),
          });
          if (result.status !== "conflict") {
            return;
          }
          observation = result.current;
        }
      }
      const key = telegramMessageCacheKey({ scopeKey, accountId, chatId, messageId });
      const node = withMedia(messages.get(key));
      messages.delete(key);
      messages.set(key, node);
      await persistCachedNode({
        bucket,
        key,
        node,
        botUserId,
        beforeWrite: hasRetainedStore && !bucket.promoted ? openRetainedStore : undefined,
      });
    },
    remove,
    isIgnored,
    get,
    recentBefore: async ({ accountId, chatId, messageId, threadId, limit }) => {
      const targetId = parseSafeMessageId(messageId);
      return targetId === undefined
        ? []
        : (
            await readNodes({
              accountId,
              chatId,
              threadId,
              maxId: targetId - 1,
              limit,
              order: "desc",
            })
          ).toReversed();
    },
    around: async ({ accountId, chatId, messageId, threadId, before, after }) => {
      const targetId = parseSafeMessageId(messageId);
      if (targetId === undefined) {
        return [];
      }
      const target = await get({ accountId, chatId, messageId });
      const thread = parseTelegramMessageThreadId(threadId);
      if (
        !target ||
        (threadId !== undefined && (thread === undefined || target.threadId !== String(thread)))
      ) {
        return [];
      }
      const [preceding, following] = await Promise.all([
        readNodes({
          accountId,
          chatId,
          threadId,
          maxId: targetId - 1,
          limit: Math.max(0, before),
          order: "desc",
        }),
        readNodes({
          accountId,
          chatId,
          threadId,
          minId: targetId + 1,
          limit: Math.max(0, after),
          order: "asc",
        }),
      ]);
      return [...preceding.toReversed(), target, ...following];
    },
    readHistoryWindow: async ({ accountId, chatId, threadId, before, limit }) => {
      if (!Number.isSafeInteger(limit) || limit <= 0) {
        return [];
      }
      const beforeId = parseSafeMessageId(before);
      if (before !== undefined && (beforeId === undefined || !retainedMessageId(before))) {
        throw new Error("Telegram history cursors must be native message IDs");
      }
      return (
        await readNodes({
          accountId,
          chatId,
          threadId,
          maxId: beforeId === undefined ? undefined : beforeId - 1,
          limit,
          scanLimit: limit,
          order: "desc",
          historyOnly: true,
        })
      ).toReversed();
    },
    readHistory: async ({ accountId, chatId, threadId, before, after, limit }) => {
      if (!Number.isSafeInteger(limit) || limit <= 0 || limit === Number.MAX_SAFE_INTEGER) {
        return { messages: [], hasMore: false };
      }
      const beforeId = parseSafeMessageId(before);
      const afterId = parseSafeMessageId(after);
      if (
        (before !== undefined && (beforeId === undefined || !retainedMessageId(before))) ||
        (after !== undefined && (afterId === undefined || !retainedMessageId(after)))
      ) {
        throw new Error("Telegram history cursors must be native message IDs");
      }
      const forward = after !== undefined && before === undefined;
      const nodes = await readNodes({
        accountId,
        chatId,
        threadId,
        minId: afterId === undefined ? undefined : afterId + 1,
        maxId: beforeId === undefined ? undefined : beforeId - 1,
        limit: limit + 1,
        order: forward ? "asc" : "desc",
        historyOnly: true,
      });
      const hasMore = nodes.length > limit;
      const selected = nodes.slice(0, limit);
      return { messages: forward ? selected : selected.toReversed(), hasMore };
    },
  };
}

export {
  buildTelegramConversationContext,
  buildTelegramReplyChain,
  TELEGRAM_REPLY_CHAIN_MAX_DEPTH,
} from "./message-cache.context.js";
