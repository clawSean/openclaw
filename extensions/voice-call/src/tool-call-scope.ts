import { isRecord, normalizeOptionalString } from "openclaw/plugin-sdk/string-coerce-runtime";
import { VoiceCallCommandInputError } from "./command-service.js";
import type { VoiceCallRuntime } from "./runtime.js";

export async function resolveActiveVoiceCallToolScope(params: {
  action: unknown;
  binding: unknown;
  requestedCallId: unknown;
  runtime: VoiceCallRuntime;
  assertAuthority: () => void;
  signal?: AbortSignal;
}): Promise<
  | {
      callId: string;
      execution: { runtime: VoiceCallRuntime; assertAuthority: () => void };
    }
  | undefined
> {
  if (!isRecord(params.binding)) {
    return undefined;
  }
  const binding = params.binding;
  const callId = normalizeOptionalString(binding.callId);
  if (binding.kind !== "active-call" || !callId) {
    return undefined;
  }
  if (params.action !== "end_call" && params.action !== "get_status") {
    throw new VoiceCallCommandInputError("This realtime consult may only get_status or end_call.");
  }
  const requestedCallId = normalizeOptionalString(params.requestedCallId);
  if (requestedCallId && requestedCallId !== callId) {
    throw new VoiceCallCommandInputError(`This realtime consult is bound to call ${callId}.`);
  }
  // Admit call control before awaiting lookup. The service owns accepted actions;
  // cancelling the consult must not interrupt their delivery or settlement.
  params.assertAuthority();
  params.signal?.throwIfAborted();
  const activeCall = await params.runtime.manager.getCallForStream(callId);
  if (!activeCall || activeCall.callId !== callId) {
    throw new VoiceCallCommandInputError("The bound realtime call is no longer active.");
  }
  if (params.action === "get_status") {
    params.signal?.throwIfAborted();
    params.assertAuthority();
  }
  return {
    callId,
    execution: { runtime: params.runtime, assertAuthority: params.assertAuthority },
  };
}
