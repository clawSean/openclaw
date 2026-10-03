import type { SessionForkAtMessageWorkerInput } from "../config/sessions/session-accessor.sqlite-message-cut-worker.types.js";
import { executeSessionForkAtMessageWorkerOperation } from "../config/sessions/session-accessor.sqlite-message-cut.js";
import type { SessionMessageCutMutationResult } from "../config/sessions/session-accessor.types.js";
import type { OpenClawAgentDatabase } from "./openclaw-agent-db-contract.js";

type ForkResult = SessionMessageCutMutationResult | { status: "conflict" };

/** Keep the fork publication transaction out of the already capped worker owner. */
export function executeForkAtMessage(
  input: SessionForkAtMessageWorkerInput,
  options: { agentId: string; path: string },
  writeTransaction: (
    operationLabel: string,
    owner: string,
    write: (current: OpenClawAgentDatabase) => ForkResult,
  ) => ForkResult,
  admit: (stage: "transaction" | "commit", publication?: unknown) => void,
): ForkResult {
  return executeSessionForkAtMessageWorkerOperation(
    { agentId: options.agentId, path: options.path, sessionKey: input.sourceKey },
    input,
    (write) => writeTransaction("session.transcript.fork-at-message", "Session fork", write),
    (publication) => admit("commit", publication),
  );
}
