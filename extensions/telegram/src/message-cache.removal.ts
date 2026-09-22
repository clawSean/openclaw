import { logVerbose } from "openclaw/plugin-sdk/runtime-env";
import { isRecord } from "openclaw/plugin-sdk/string-coerce-runtime";
import { normalizeMessageNode, type TelegramCachedMessageNode } from "./message-cache-codec.js";
import {
  isTelegramMessageCacheSourceMessage,
  type PersistedTelegramMessageCacheValue,
  TELEGRAM_MESSAGE_CACHE_PERSISTED_VERSION,
} from "./message-cache-persistence.js";
import type {
  TelegramMessageCache,
  TelegramMessageCacheBucket,
  TelegramMessageCacheRetainedStore,
} from "./message-cache.js";
import {
  detachReplyTargetsById,
  registerPrivacyIdentity,
  telegramIgnoredMediaGroupIdentity,
  telegramIgnoredMediaGroupKey,
  telegramIgnoredMessageIdentity,
  telegramIgnoredMessageKey,
} from "./message-cache.privacy.js";

const RETAINED_MESSAGE_PAGE_SIZE = 256;

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

export function createTelegramMessageCacheRemoval(params: {
  bucket: TelegramMessageCacheBucket;
  messages: Map<string, TelegramCachedMessageNode>;
  scopeKey: string | undefined;
  hydrate: () => Promise<void>;
  usesRetainedHistory: (accountId: string, chatId: string | number) => boolean;
  openRetainedStore: () => Promise<TelegramMessageCacheRetainedStore>;
  runMutation: <T>(
    accountId: string,
    chatId: string | number,
    mutate: () => Promise<T>,
  ) => Promise<T>;
}): TelegramMessageCache["remove"] {
  const { bucket, messages, scopeKey } = params;
  const detachCachedReplyDescendants = (paramsLocal: {
    prefix: string;
    messageIds: ReadonlySet<string>;
    chatId: string | number;
  }): boolean => {
    let changed = false;
    for (const [key, node] of messages) {
      if (!key.startsWith(paramsLocal.prefix)) {
        continue;
      }
      const sourceMessage = detachReplyTargetsById(
        node.sourceMessage,
        paramsLocal.messageIds,
        paramsLocal.chatId,
      );
      if (sourceMessage === node.sourceMessage) {
        continue;
      }
      messages.set(
        key,
        normalizeMessageNode(sourceMessage, {
          ...(node.threadId ? { threadId: Number(node.threadId) } : {}),
          ...(node.promptContextProjectionMarker
            ? { promptContextProjectionMarker: node.promptContextProjectionMarker }
            : {}),
          ...(node.resolvedMedia ? { resolvedMedia: node.resolvedMedia } : {}),
          ...(node.threadBinding ? { threadBinding: node.threadBinding } : {}),
          ...(node.historyEligible ? { historyEligible: true } : {}),
        }),
      );
      changed = true;
    }
    return changed;
  };

  const remove: TelegramMessageCache["remove"] = async ({
    accountId,
    chatId,
    messageId,
    mediaGroupId,
  }) => {
    await params.hydrate();
    registerPrivacyIdentity(bucket, {
      kind: "ignored-message",
      identity: telegramIgnoredMessageIdentity({ accountId, chatId, messageId }),
    });
    if (mediaGroupId) {
      registerPrivacyIdentity(bucket, {
        kind: "ignored-media-group",
        identity: telegramIgnoredMediaGroupIdentity({ accountId, chatId, mediaGroupId }),
      });
    }

    return params.runMutation(accountId, chatId, async () => {
      const prefix = telegramMessageCacheKeyPrefix({ scopeKey, accountId, chatId });
      const messageIds = new Set([messageId]);

      if (mediaGroupId) {
        for (const [key, node] of messages) {
          if (key.startsWith(prefix) && node.sourceMessage.media_group_id === mediaGroupId) {
            messageIds.add(node.messageId);
          }
        }
      }
      // Revoke live context before durable storage can yield. The final pass below also covers
      // album members discovered only in persistent state.
      let removed = false;
      for (const targetId of messageIds) {
        removed =
          messages.delete(
            telegramMessageCacheKey({ scopeKey, accountId, chatId, messageId: targetId }),
          ) || removed;
      }
      removed = detachCachedReplyDescendants({ prefix, messageIds, chatId }) || removed;

      const errors: unknown[] = [];
      if (bucket.privacyStore) {
        try {
          if (mediaGroupId) {
            await bucket.privacyStore.register(
              telegramIgnoredMediaGroupKey({ scopeKey, accountId, chatId, mediaGroupId }),
              {
                version: TELEGRAM_MESSAGE_CACHE_PERSISTED_VERSION,
                kind: "ignored-media-group",
                accountId,
                chatId: String(chatId),
                mediaGroupId,
              },
            );
          }
          await bucket.privacyStore.register(
            telegramIgnoredMessageKey({ scopeKey, accountId, chatId, messageId }),
            {
              version: TELEGRAM_MESSAGE_CACHE_PERSISTED_VERSION,
              kind: "ignored-message",
              accountId,
              chatId: String(chatId),
              messageId,
            },
          );
          removed = true;
        } catch (error) {
          errors.push(error);
        }
      }

      if (params.usesRetainedHistory(accountId, chatId)) {
        try {
          const store = await params.openRetainedStore();
          const rows: Array<{ key: string; value: PersistedTelegramMessageCacheValue }> = [];
          let keyStartInclusive = prefix;
          for (;;) {
            const page = await store.entriesInKeyRange({
              keyStartInclusive,
              keyEndExclusive: `${prefix}~`,
              limit: RETAINED_MESSAGE_PAGE_SIZE,
              order: "asc",
            });
            for (const row of page) {
              if (
                isRecord(row.value) &&
                isTelegramMessageCacheSourceMessage(row.value.sourceMessage)
              ) {
                // SAFETY: the sourceMessage guard above establishes a persisted cache value.
                rows.push({ key: row.key, value: row.value as PersistedTelegramMessageCacheValue });
                if (mediaGroupId && row.value.sourceMessage.media_group_id === mediaGroupId) {
                  messageIds.add(String(row.value.sourceMessage.message_id));
                }
              }
            }
            if (page.length < RETAINED_MESSAGE_PAGE_SIZE) {
              break;
            }
            keyStartInclusive = `${page.at(-1)!.key}\0`;
          }
          for (const row of rows) {
            const rowId = String(row.value.sourceMessage.message_id);
            const shouldDelete = messageIds.has(rowId);
            const detached = shouldDelete
              ? row.value.sourceMessage
              : detachReplyTargetsById(row.value.sourceMessage, messageIds, chatId);
            if (!shouldDelete && detached === row.value.sourceMessage) {
              continue;
            }
            let observation = await store.observe(row.key);
            for (;;) {
              const current = observation.value;
              if (!current || !isTelegramMessageCacheSourceMessage(current.sourceMessage)) {
                break;
              }
              const currentId = String(current.sourceMessage.message_id);
              const deleteCurrent = messageIds.has(currentId);
              const currentDetached = deleteCurrent
                ? current.sourceMessage
                : detachReplyTargetsById(current.sourceMessage, messageIds, chatId);
              if (!deleteCurrent && currentDetached === current.sourceMessage) {
                break;
              }
              const result = await store.compareAndApply(
                row.key,
                observation.comparison,
                deleteCurrent
                  ? { operation: "delete", action: "delete" }
                  : {
                      operation: "update",
                      action: "set",
                      value: { ...current, sourceMessage: currentDetached },
                    },
              );
              if (result.status !== "conflict") {
                removed = true;
                break;
              }
              observation = result.current;
            }
          }
        } catch (error) {
          errors.push(error);
        }
      } else if (bucket.persistentStore) {
        try {
          const rows = await bucket.persistentStore.entries();
          if (mediaGroupId) {
            for (const { key, value } of rows) {
              if (
                key.startsWith(prefix) &&
                isRecord(value) &&
                isTelegramMessageCacheSourceMessage(value.sourceMessage) &&
                value.sourceMessage.media_group_id === mediaGroupId
              ) {
                messageIds.add(String(value.sourceMessage.message_id));
              }
            }
          }
          for (const { key, value } of rows) {
            if (
              !key.startsWith(prefix) ||
              !isRecord(value) ||
              !isTelegramMessageCacheSourceMessage(value.sourceMessage)
            ) {
              continue;
            }
            if (messageIds.has(String(value.sourceMessage.message_id))) {
              removed = (await bucket.persistentStore.delete(key)) || removed;
              continue;
            }
            const sourceMessage = detachReplyTargetsById(value.sourceMessage, messageIds, chatId);
            if (sourceMessage !== value.sourceMessage) {
              await bucket.persistentStore.register(key, {
                // SAFETY: the sourceMessage guard above establishes a persisted cache value.
                ...(value as PersistedTelegramMessageCacheValue),
                sourceMessage,
              });
              removed = true;
            }
          }
        } catch (error) {
          errors.push(error);
        }
      }

      const initialSize = messages.size;
      for (const targetId of messageIds) {
        messages.delete(
          telegramMessageCacheKey({ scopeKey, accountId, chatId, messageId: targetId }),
        );
      }
      removed =
        detachCachedReplyDescendants({ prefix, messageIds, chatId }) ||
        messages.size !== initialSize ||
        removed;
      if (errors.length > 0) {
        const error =
          errors.length === 1
            ? errors[0]
            : new AggregateError(errors, "Telegram message privacy cleanup failed");
        logVerbose(`telegram: failed to remove message from persistent cache: ${String(error)}`);
        throw error;
      }
      return removed;
    });
  };

  return remove;
}
