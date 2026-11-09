import {
  prepareSessionBindingInspections,
  type ConversationRef,
  type SessionBindingRecord,
} from "../../infra/outbound/session-binding-service.js";
import type { TurnAdoptionLifecycle } from "../get-reply-options.types.js";

export class ConversationForkBindingChangedError extends Error {}

/** Keep an awaited binding selection valid through a later synchronous effect grant. */
export async function prepareConversationForkBindingGuard(params: {
  conversation: ConversationRef;
  assertCurrent: () => void;
  matches: (binding: SessionBindingRecord | null) => boolean;
  message: string;
}) {
  const prepared = await prepareSessionBindingInspections([params.conversation]);
  const assertCurrent = () => {
    params.assertCurrent();
    let inspection: ReturnType<typeof prepared.inspect>[number] | undefined;
    try {
      inspection = prepared.inspect()[0];
    } catch (error) {
      throw new ConversationForkBindingChangedError(params.message, { cause: error });
    }
    if (!inspection || inspection.status !== "available" || !params.matches(inspection.binding)) {
      throw new ConversationForkBindingChangedError(params.message);
    }
  };
  try {
    assertCurrent();
    return { assertCurrent, dispose: prepared.dispose };
  } catch (error) {
    prepared.dispose();
    throw error;
  }
}

/** Retain a prepared replay fence only while its direct or deferred turn owns custody. */
export function createConversationForkReplayGuardLease(
  guard: Awaited<ReturnType<typeof prepareConversationForkBindingGuard>>,
) {
  let deferred = false;
  let disposed = false;
  const dispose = () => {
    if (disposed) {
      return;
    }
    disposed = true;
    guard.dispose();
  };
  const lifecycle: TurnAdoptionLifecycle = {
    admission: "exclusive",
    onAdopted: guard.assertCurrent,
    onDeferred: () => {
      guard.assertCurrent();
      deferred = true;
    },
    onAbandoned: dispose,
    onSettled: dispose,
  };
  return {
    lifecycle,
    dispose,
    disposeUnlessDeferred: () => {
      if (!deferred) {
        dispose();
      }
    },
  };
}
