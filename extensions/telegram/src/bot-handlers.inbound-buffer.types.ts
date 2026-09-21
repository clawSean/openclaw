import type { Message } from "grammy/types";
import type { TelegramPendingInboundTarget } from "./bot-handlers.types.js";
import type { TelegramMediaRef } from "./bot-message-context.js";
import type {
  TelegramAmbientTranscriptWatermark,
  TelegramChannelIngressResolver,
} from "./bot-message-context.types.js";
import type { TelegramSpooledReplayDeferredParticipant } from "./bot-processing-outcome.js";
import type { TelegramThreadSpec } from "./bot/helpers.js";
import type { TelegramContext } from "./bot/types.js";
import type { TelegramMessageDispatchReplayClaim } from "./message-dispatch-dedupe.js";

export type TelegramDebounceLane = "default" | "forward";

export type TelegramDebounceEntry = {
  ctx: TelegramContext;
  msg: Message;
  allMedia: TelegramMediaRef[];
  storeAllowFrom: string[];
  receivedAtMs: number;
  debounceKey: string | null;
  debounceLane: TelegramDebounceLane;
  botUsername?: string;
  threadSpec: TelegramThreadSpec;
  promptContextMinTimestampMs?: number;
  promptContextAmbientWatermark?: TelegramAmbientTranscriptWatermark;
  dispatchDedupeClaims: TelegramMessageDispatchReplayClaim[];
  spooledReplayParticipant?: TelegramSpooledReplayDeferredParticipant;
  channelIngressResolvers: readonly TelegramChannelIngressResolver[];
  cancelled: boolean;
  dispatchAdmission: "pending" | "admitted" | "cancelled";
  dispatchAbortControllers: Set<AbortController>;
  pendingIgnoreSettlements: Set<Promise<void>>;
};

export type PendingBufferedMessageIgnore = {
  settle: (authorized: boolean) => boolean;
};

export interface TelegramInboundBuffers {
  cancelPending: (target: TelegramPendingInboundTarget) => void;
  inboundDebouncer: {
    enqueue: (entry: TelegramDebounceEntry) => Promise<void>;
    shouldBuffer: (entry: TelegramDebounceEntry) => boolean;
    flushKey: (key: string) => Promise<void>;
    cancelKey: (key: string) => boolean;
    drain: () => Promise<void>;
  };
  resolveTelegramDebounceLane: (msg: Message) => TelegramDebounceLane;
  beginPendingBufferedMessageIgnore: (msg: Message) => PendingBufferedMessageIgnore | undefined;
}
