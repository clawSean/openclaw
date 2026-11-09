import { isDeepStrictEqual } from "node:util";
import type { ConversationRef } from "../../infra/outbound/session-binding.types.js";
import { cloneEnvWithPlatformSemantics } from "../config-env-vars.js";
import { findSessionTranscriptActiveEventInSnapshot } from "./session-accessor.sqlite-active-events-read.js";
import { withCurrentProjectionSnapshot } from "./session-accessor.sqlite-active-projection.js";
import type {
  SessionTranscriptReadScope,
  SessionTranscriptRuntimeTarget,
  TranscriptEvent,
} from "./session-accessor.types.js";

export type SessionForkReplySelectionWorkerInput = {
  kind: "fork-reply-selection";
  target: SessionTranscriptRuntimeTarget;
  replyToId: string;
  conversation: ConversationRef;
  replyConversationRef?: string;
};

export type SessionForkReplySelection =
  | { status: "found"; entryId: string; text: string }
  | { status: "media" }
  | { status: "missing" };

type SessionForkReplySelectionCriteria = {
  replyToId: string;
  conversation: ConversationRef;
  replyConversationRef?: string;
};

function selectSessionForkReplyEvent(
  event: TranscriptEvent,
  input: SessionForkReplySelectionCriteria,
): SessionForkReplySelection | undefined {
  // SAFETY: transcript events are partial untrusted records; every consumed field is checked.
  const candidate = event as {
    id?: unknown;
    message?: {
      role?: unknown;
      content?: unknown;
      media?: unknown;
      __openclaw?: {
        transport?: {
          messageId?: unknown;
          conversation?: unknown;
          conversationRef?: unknown;
          channel?: unknown;
        };
        media?: unknown;
      };
    };
  };
  const message = candidate.message;
  const transport = message?.["__openclaw"]?.transport;
  if (
    typeof candidate.id !== "string" ||
    message?.role !== "user" ||
    transport?.messageId !== input.replyToId ||
    (input.replyConversationRef
      ? transport?.conversationRef !== input.replyConversationRef ||
        transport?.channel !== input.conversation.channel
      : !isDeepStrictEqual(transport?.conversation, input.conversation))
  ) {
    return undefined;
  }
  const media = message["__openclaw"]?.media ?? message.media;
  if (Array.isArray(media) && media.length > 0) {
    return { status: "media" };
  }
  const content = message.content;
  if (
    Array.isArray(content) &&
    content.some(
      (part) =>
        !part ||
        typeof part !== "object" ||
        !("type" in part) ||
        part.type !== "text" ||
        !("text" in part) ||
        typeof part.text !== "string",
    )
  ) {
    return { status: "media" };
  }
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content
            .map((part) => {
              // SAFETY: the preceding array guard verified every part is a text record.
              return part.text as string;
            })
            .join("")
        : "";
  return text.trim() ? { status: "found", entryId: candidate.id, text } : { status: "missing" };
}

/** Select the newest matching reply from the memory actor's chronological active path. */
export function selectSessionForkReplyFromChronologicalEvents(
  input: SessionForkReplySelectionCriteria & { events: readonly TranscriptEvent[] },
): SessionForkReplySelection {
  for (let index = input.events.length - 1; index >= 0; index -= 1) {
    const selected = selectSessionForkReplyEvent(input.events[index]!, input);
    if (selected) {
      return selected;
    }
  }
  return { status: "missing" };
}

/** Select one active-path reply target inside the transcript worker's read snapshot. */
function readSessionForkReplySelection(input: {
  target: SessionTranscriptReadScope;
  replyToId: string;
  conversation: ConversationRef;
  replyConversationRef?: string;
}): SessionForkReplySelection {
  return withCurrentProjectionSnapshot(
    input.target,
    (projection) =>
      findSessionTranscriptActiveEventInSnapshot(projection, (event) =>
        selectSessionForkReplyEvent(event, input),
      ) ?? { status: "missing" },
  );
}

/** Resolve a worker request against its process-local environment snapshot. */
export function readSessionForkReplySelectionInWorker(
  input: SessionForkReplySelectionWorkerInput,
): SessionForkReplySelection {
  return readSessionForkReplySelection({
    ...input,
    target: { ...input.target, env: cloneEnvWithPlatformSemantics(process.env) },
  });
}
