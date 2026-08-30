import type { SessionEntry } from "./types.js";

type SessionPresentationSelection = Pick<SessionEntry, "ttsAuto" | "streamingMode">;

export function selectSessionPresentation(
  entry: Partial<SessionPresentationSelection> | undefined,
): SessionPresentationSelection {
  return {
    ttsAuto: entry?.ttsAuto,
    streamingMode: entry?.streamingMode,
  };
}
