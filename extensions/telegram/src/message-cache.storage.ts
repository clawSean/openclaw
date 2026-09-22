import { logVerbose } from "openclaw/plugin-sdk/runtime-env";
import {
  mergeCachedMessageNode,
  parseRetainedCacheNode,
  persistedCacheNode,
  type TelegramCachedMessageNode,
  type TelegramMessageObservationMode,
} from "./message-cache-codec.js";
import {
  type PersistedTelegramMessageCacheValue,
  type PersistedTelegramMessagePrivacyEntry,
  TELEGRAM_MESSAGE_CACHE_PERSISTENT_MAX_MESSAGES,
  TELEGRAM_MESSAGE_CACHE_PERSISTENT_NAMESPACE,
  TELEGRAM_MESSAGE_PRIVACY_PERSISTENT_MAX_ENTRIES,
  TELEGRAM_MESSAGE_PRIVACY_PERSISTENT_NAMESPACE,
} from "./message-cache-persistence.js";
import type {
  TelegramMessageCacheBucket,
  TelegramMessageCachePersistentStore,
  TelegramMessageCacheRetainedStore,
  TelegramMessagePrivacyPersistentStore,
} from "./message-cache.js";
import { getOptionalTelegramRuntime } from "./runtime.js";

const TELEGRAM_MESSAGE_CACHE_BUCKETS_KEY = Symbol.for("openclaw.telegram.messageCacheBuckets");

function getPersistedMessageCacheBuckets(): Map<string, TelegramMessageCacheBucket> {
  // SAFETY: OpenClaw owns this global symbol slot and stores only the bucket map below.
  const globalRecord = globalThis as Record<PropertyKey, unknown>;
  // SAFETY: this symbol is populated only by this function with the declared map type.
  const existing = globalRecord[TELEGRAM_MESSAGE_CACHE_BUCKETS_KEY] as
    | Map<string, TelegramMessageCacheBucket>
    | undefined;
  if (existing) {
    return existing;
  }
  const created = new Map<string, TelegramMessageCacheBucket>();
  globalRecord[TELEGRAM_MESSAGE_CACHE_BUCKETS_KEY] = created;
  return created;
}

export function trimMessages(
  messages: Map<string, TelegramCachedMessageNode>,
  maxMessages: number,
): void {
  while (messages.size > maxMessages) {
    const oldest = messages.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    messages.delete(oldest);
  }
}

export function upsertCachedMessageNode(params: {
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

export function resolveDefaultPersistentStore(): TelegramMessageCachePersistentStore | undefined {
  const runtime = getOptionalTelegramRuntime();
  if (!runtime) {
    return undefined;
  }
  try {
    return runtime.state.openKeyedStore<PersistedTelegramMessageCacheValue>({
      namespace: TELEGRAM_MESSAGE_CACHE_PERSISTENT_NAMESPACE,
      maxEntries: TELEGRAM_MESSAGE_CACHE_PERSISTENT_MAX_MESSAGES,
    });
  } catch (error) {
    logVerbose(`telegram: failed to open message cache plugin state: ${String(error)}`);
    return undefined;
  }
}

export function resolveDefaultPrivacyStore(params: {
  requiredForPersistentMessageCache: boolean;
}): TelegramMessagePrivacyPersistentStore | undefined {
  const runtime = getOptionalTelegramRuntime();
  if (!runtime) {
    if (params.requiredForPersistentMessageCache) {
      throw new Error(
        "Telegram message privacy state is unavailable while message cache persistence is enabled",
      );
    }
    return undefined;
  }
  try {
    return runtime.state.openKeyedStore<PersistedTelegramMessagePrivacyEntry>({
      namespace: TELEGRAM_MESSAGE_PRIVACY_PERSISTENT_NAMESPACE,
      maxEntries: TELEGRAM_MESSAGE_PRIVACY_PERSISTENT_MAX_ENTRIES,
    });
  } catch (error) {
    logVerbose(`telegram: failed to open message privacy state: ${String(error)}`);
    if (params.requiredForPersistentMessageCache) {
      throw error;
    }
    return undefined;
  }
}

export function resolveMessageCacheBucket(params: {
  bucketKey?: string;
  persistentStore?: TelegramMessageCachePersistentStore;
  privacyStore?: TelegramMessagePrivacyPersistentStore;
}): TelegramMessageCacheBucket {
  const { bucketKey } = params;
  if (!bucketKey) {
    return {
      messages: new Map<string, TelegramCachedMessageNode>(),
      ignoredMessages: new Set<string>(),
      ignoredMediaGroups: new Set<string>(),
      privacyIdentities: new Map(),
      hydrated: true,
      ...(params.privacyStore ? { privacyStore: params.privacyStore } : {}),
    };
  }
  const persistedMessageCacheBuckets = getPersistedMessageCacheBuckets();
  const existing = persistedMessageCacheBuckets.get(bucketKey);
  if (existing) {
    existing.ignoredMessages ??= new Set<string>();
    existing.ignoredMediaGroups ??= new Set<string>();
    existing.privacyIdentities ??= new Map();
    existing.persistentStore = params.persistentStore ?? existing.persistentStore;
    existing.privacyStore = params.privacyStore ?? existing.privacyStore;
    return existing;
  }
  const bucket = {
    messages: new Map<string, TelegramCachedMessageNode>(),
    ignoredMessages: new Set<string>(),
    ignoredMediaGroups: new Set<string>(),
    privacyIdentities: new Map(),
    hydrated: false,
    ...(params.persistentStore ? { persistentStore: params.persistentStore } : {}),
    ...(params.privacyStore ? { privacyStore: params.privacyStore } : {}),
  };
  persistedMessageCacheBuckets.set(bucketKey, bucket);
  return bucket;
}

export async function mergeRetainedCacheNode(params: {
  store: TelegramMessageCacheRetainedStore;
  key: string;
  node: TelegramCachedMessageNode;
  mode: TelegramMessageObservationMode;
  botUserId?: number;
}): Promise<TelegramCachedMessageNode | null> {
  let observation = await params.store.observe(params.key);
  let sawExisting = observation.value !== undefined;
  for (;;) {
    const existing = parseRetainedCacheNode(params.key, observation.value);
    // An embedded snapshot is context, not a new observation of a deleted message.
    if (params.mode === "partial" && sawExisting && !existing) {
      return null;
    }
    sawExisting ||= existing !== null;
    const node = existing
      ? mergeCachedMessageNode(existing, params.node, params.mode)
      : params.node;
    const result = await params.store.compareAndApply(params.key, observation.comparison, {
      operation: "update",
      action: "set",
      value: persistedCacheNode(node, params.botUserId ?? observation.value?.botUserId),
    });
    if (result.status !== "conflict") {
      return node;
    }
    observation = result.current;
  }
}

export async function runMessageCacheMutation<T>(params: {
  bucket: TelegramMessageCacheBucket;
  key: string;
  mutate: () => Promise<T>;
}): Promise<T> {
  params.bucket.mutationTails ??= new Map();
  const previous = params.bucket.mutationTails.get(params.key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.catch(() => undefined).then(() => gate);
  params.bucket.mutationTails.set(params.key, tail);
  await previous.catch(() => undefined);
  try {
    return await params.mutate();
  } finally {
    release();
    if (params.bucket.mutationTails.get(params.key) === tail) {
      params.bucket.mutationTails.delete(params.key);
    }
  }
}

export async function persistCachedNode(params: {
  bucket: TelegramMessageCacheBucket;
  key: string;
  node: TelegramCachedMessageNode;
  botUserId?: number;
  beforeWrite?: () => Promise<unknown>;
}): Promise<void> {
  const { persistentStore } = params.bucket;
  if (!persistentStore) {
    return;
  }
  try {
    // A bounded insert may evict legacy group content until namespace promotion settles.
    if (params.beforeWrite) {
      await params.beforeWrite();
    }
    await persistentStore.register(params.key, persistedCacheNode(params.node, params.botUserId));
  } catch (error) {
    logVerbose(`telegram: failed to persist message cache: ${String(error)}`);
    const marker = params.node.promptContextProjectionMarker;
    if (marker) {
      params.node.promptContextProjectionMarker = {
        kind: "invalid",
        transcriptMessageId:
          marker.kind === "valid"
            ? marker.projection.transcriptMessageId
            : marker.transcriptMessageId,
      };
      throw error;
    }
  }
}
