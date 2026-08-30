import { normalizeOptionalLowercaseString } from "@openclaw/normalization-core/string-coerce";
import type { StreamingMode } from "../config/types.base.js";

export function parsePreviewStreamingMode(value: unknown): StreamingMode | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = normalizeOptionalLowercaseString(value);
  if (
    normalized === "off" ||
    normalized === "partial" ||
    normalized === "block" ||
    normalized === "progress"
  ) {
    return normalized;
  }
  return null;
}
