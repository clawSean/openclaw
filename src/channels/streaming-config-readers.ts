// Pure readers for a channel entry's `streaming` config object.
//
// Split out of `streaming.ts` because that module also formats tool aggregates
// and therefore value-loads the tool-display/logging graph. Doctor contract
// closures read streaming config during config-compat migration, and doctor
// enumeration cold-loads those closures for every declaring plugin.
import { asNullableRecord as asObjectRecord } from "@openclaw/normalization-core/record-coerce";
import type {
  ChannelStreamingConfig,
  ChannelStreamingProgressConfig,
} from "../config/types.base.js";
import { asBoolean } from "../utils/boolean.js";

export type StreamingCompatEntry = { streaming?: unknown };

export function getChannelStreamingConfigObject(
  entry: StreamingCompatEntry | null | undefined,
): ChannelStreamingConfig | undefined {
  const streaming = asObjectRecord(entry?.streaming);
  return streaming ? (streaming as ChannelStreamingConfig) : undefined;
}

export function resolveChannelStreamingNativeTransport(
  entry: StreamingCompatEntry | null | undefined,
): boolean | undefined {
  return asBoolean(getChannelStreamingConfigObject(entry)?.nativeTransport);
}

const DEFAULT_PROGRESS_DRAFT_MAX_LINE_CHARS = 120;

function asInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

function asProgressConfig(value: unknown): ChannelStreamingProgressConfig | undefined {
  // SAFETY: individual progress readers normalize the fields of this config record.
  return (asObjectRecord(value) as ChannelStreamingProgressConfig | null) ?? undefined;
}

export function resolveChannelProgressDraftConfig(
  entry: StreamingCompatEntry | null | undefined,
): ChannelStreamingProgressConfig {
  return asProgressConfig(getChannelStreamingConfigObject(entry)?.progress) ?? {};
}

export function resolveChannelProgressDraftMaxLines(
  entry: StreamingCompatEntry | null | undefined,
  defaultValue = 8,
): number {
  const configured = asInteger(resolveChannelProgressDraftConfig(entry).maxLines);
  return configured && configured > 0 ? configured : defaultValue;
}

export function resolveChannelProgressDraftMaxLineChars(
  entry: StreamingCompatEntry | null | undefined,
  defaultValue = DEFAULT_PROGRESS_DRAFT_MAX_LINE_CHARS,
): number {
  const configured = asInteger(resolveChannelProgressDraftConfig(entry).maxLineChars);
  return configured && configured > 0 ? configured : defaultValue;
}
