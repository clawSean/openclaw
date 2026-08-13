import { hasOutboundReplyContent } from "openclaw/plugin-sdk/reply-payload";
import type { BlockReplyContext } from "../get-reply-options.types.js";
import {
  isReplyPayloadOwnedTtsToolMedia,
  isReplyPayloadStatusNotice,
  type ReplyPayload,
} from "../reply-payload.js";
import { toTrustedMediaOnlyPayload } from "./dispatch-from-config.payloads.js";
import type { PrepareDispatchExecutionReadyState } from "./dispatch-from-config.prepare-execution.js";

export async function deliverSuppressedTrustedTtsBlock(
  state: PrepareDispatchExecutionReadyState,
  inputPayload: ReplyPayload,
  context?: BlockReplyContext,
): Promise<void> {
  if (state.sendPolicyDenied || state.sourceReplyDeliveryMode !== "message_tool_only") {
    return;
  }
  // message_tool_only suppresses ordinary source text. Only already-produced
  // media from the owned dynamic TTS tool may cross that boundary, and it must
  // do so without carrying source text.
  if (
    inputPayload.isReasoning === true ||
    inputPayload.isCommentary === true ||
    isReplyPayloadStatusNotice(inputPayload)
  ) {
    return;
  }

  if (!isReplyPayloadOwnedTtsToolMedia(inputPayload)) {
    return;
  }
  const normalizedPayload = await state.normalizeReplyMediaPayload(inputPayload);
  if (state.isDispatchOperationAborted()) {
    return;
  }
  const mediaOnlyPayload = toTrustedMediaOnlyPayload(normalizedPayload);
  if (
    !isReplyPayloadOwnedTtsToolMedia(normalizedPayload) ||
    normalizedPayload.trustedLocalMedia !== true ||
    normalizedPayload.sensitiveMedia === true ||
    !hasOutboundReplyContent(mediaOnlyPayload, { trimText: true })
  ) {
    return;
  }
  if (state.shouldRouteToOriginating) {
    const result = await state.sendPayloadAsync(
      mediaOnlyPayload,
      context?.abortSignal,
      false,
      "block",
    );
    state.recordRoutedBlockReplyDelivery(mediaOnlyPayload, result);
  } else {
    state.markInboundDedupeReplayUnsafe();
    if (state.sendTrackedBlockReply(mediaOnlyPayload)) {
      state.progressState.hasPendingDirectBlockReplyDelivery = true;
    }
  }
}
