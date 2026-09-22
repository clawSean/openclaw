import { logVerbose } from "openclaw/plugin-sdk/runtime-env";
import { isRecord } from "openclaw/plugin-sdk/string-coerce-runtime";
import {
  isGroupMessage,
  mergeCachedMessageNode,
  parsePersistedCacheValue,
  type TelegramCachedMessageNode,
  type TelegramMessageObservationMode,
} from "./message-cache-codec.js";
import {
  isTelegramMessageCacheSourceMessage,
  parsePersistedTelegramIgnoredMediaGroup,
  parsePersistedTelegramIgnoredMessage,
} from "./message-cache-persistence.js";
import type { TelegramMessageCacheBucket } from "./message-cache.js";
import {
  detachReplyTargetsByPrivacy,
  registerPrivacyIdentity,
  telegramIgnoredMediaGroupIdentity,
  telegramIgnoredMessageIdentity,
} from "./message-cache.privacy.js";

function telegramMessageCacheKeyPrefix(params: {
  scopeKey: string | undefined;
  accountId: string;
  chatId: string | number;
}) {
  const prefix = `${params.accountId}:${params.chatId}:`;
  return params.scopeKey ? `${params.scopeKey}:${prefix}` : prefix;
}

function trimMessages(messages: Map<string, TelegramCachedMessageNode>, maxMessages: number): void {
  while (messages.size > maxMessages) {
    const oldest = messages.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    messages.delete(oldest);
  }
}

function upsertCachedMessageNode(params: {
  messages: Map<string, TelegramCachedMessageNode>;
  key: string;
  node: TelegramCachedMessageNode;
  mode: TelegramMessageObservationMode;
}): TelegramCachedMessageNode {
  const existing = params.messages.get(params.key);
  const node = existing ? mergeCachedMessageNode(existing, params.node, params.mode) : params.node;
  params.messages.delete(params.key);
  params.messages.set(params.key, node);
  return node;
}

export async function hydrateMessageCacheBucket(
  bucket: TelegramMessageCacheBucket,
  maxMessages: number,
  scopeKey?: string,
  excludeGroups = false,
): Promise<void> {
  if (bucket.hydrated) {
    return;
  }
  if (bucket.hydratePromise) {
    await bucket.hydratePromise;
    return;
  }
  bucket.hydratePromise = (async () => {
    let storeEntries: Array<{ key: string; value: unknown }> = [];
    let privacyEntries: Array<{ key: string; value: unknown }>;
    try {
      storeEntries = (await bucket.persistentStore?.entries()) ?? [];
    } catch (error) {
      logVerbose(`telegram: failed to hydrate message cache from plugin state: ${String(error)}`);
    }
    try {
      privacyEntries = (await bucket.privacyStore?.entries()) ?? [];
    } catch (error) {
      logVerbose(`telegram: failed to hydrate message privacy state: ${String(error)}`);
      throw error;
    }
    const scopedStoreEntries = scopeKey
      ? storeEntries.filter(({ key }) => key.startsWith(`${scopeKey}:`))
      : storeEntries;
    const scopedPrivacyEntries = scopeKey
      ? privacyEntries.filter(({ key }) => key.startsWith(`${scopeKey}:`))
      : privacyEntries;
    const ignoredMessages = scopedPrivacyEntries.flatMap(({ value }) => {
      const ignored = parsePersistedTelegramIgnoredMessage(value);
      return ignored ? [ignored] : [];
    });
    const ignoredMediaGroups = [...scopedPrivacyEntries, ...scopedStoreEntries].flatMap(
      ({ value }) => {
        const ignored = parsePersistedTelegramIgnoredMediaGroup(value);
        return ignored ? [ignored] : [];
      },
    );
    for (const ignored of ignoredMessages) {
      registerPrivacyIdentity(bucket, {
        kind: "ignored-message",
        identity: telegramIgnoredMessageIdentity(ignored),
      });
    }
    for (const ignored of ignoredMediaGroups) {
      registerPrivacyIdentity(bucket, {
        kind: "ignored-media-group",
        identity: telegramIgnoredMediaGroupIdentity(ignored),
      });
    }

    for (const { key, value } of scopedStoreEntries) {
      if (parsePersistedTelegramIgnoredMediaGroup(value)) {
        continue;
      }
      const sourceMessage =
        isRecord(value) && isTelegramMessageCacheSourceMessage(value.sourceMessage)
          ? value.sourceMessage
          : undefined;
      const relevantIgnoredMessages = ignoredMessages.filter((ignored) =>
        key.startsWith(
          telegramMessageCacheKeyPrefix({
            scopeKey,
            accountId: ignored.accountId,
            chatId: ignored.chatId,
          }),
        ),
      );
      const relevantIgnoredMediaGroups = ignoredMediaGroups.filter((ignored) =>
        key.startsWith(
          telegramMessageCacheKeyPrefix({
            scopeKey,
            accountId: ignored.accountId,
            chatId: ignored.chatId,
          }),
        ),
      );
      const ignoredMessageIds = new Set(relevantIgnoredMessages.map((entry) => entry.messageId));
      const ignoredMediaGroupIds = new Set(
        relevantIgnoredMediaGroups.map((entry) => entry.mediaGroupId),
      );
      if (
        sourceMessage &&
        (ignoredMessageIds.has(String(sourceMessage.message_id)) ||
          (typeof sourceMessage.media_group_id === "string" &&
            ignoredMediaGroupIds.has(sourceMessage.media_group_id)))
      ) {
        try {
          await bucket.persistentStore?.delete(key);
        } catch (error) {
          logVerbose(`telegram: failed to purge ignored hydrated message: ${String(error)}`);
        }
        continue;
      }
      const hydratedValue = sourceMessage
        ? {
            // SAFETY: sourceMessage validation above establishes that value is a record.
            ...(value as Record<string, unknown>),
            sourceMessage: detachReplyTargetsByPrivacy(sourceMessage, {
              chatId: sourceMessage.chat.id,
              ignoredMessageIds,
              ignoredMediaGroupIds,
            }),
          }
        : value;
      if (excludeGroups && sourceMessage && isGroupMessage(sourceMessage)) {
        bucket.chatRetention?.set(key.slice(0, key.lastIndexOf(":") + 1), "retained");
        continue;
      }
      for (const entry of parsePersistedCacheValue(key, hydratedValue)) {
        bucket.chatRetention?.set(entry.key.slice(0, entry.key.lastIndexOf(":") + 1), "bounded");
        upsertCachedMessageNode({
          messages: bucket.messages,
          key: entry.key,
          node: entry.node,
          mode: entry.mode,
        });
        trimMessages(bucket.messages, maxMessages);
      }
    }
    bucket.hydrated = true;
  })().finally(() => {
    bucket.hydratePromise = undefined;
  });
  await bucket.hydratePromise;
}
