import {
  createMessageReceiptFromOutboundResults,
  type ChannelMessageUnknownSendContext,
  type ChannelMessageUnknownSendReconciliationResult,
} from "openclaw/plugin-sdk/channel-outbound";
import { resolveIMessageAccount } from "./accounts.js";
import { createIMessageRpcClient, type IMessageRpcClient } from "./client.js";
import { DEFAULT_IMESSAGE_PROBE_TIMEOUT_MS } from "./constants.js";
import { resolveIMessageRemoteHost } from "./remote-host.js";
import { deriveIMessageAttemptId } from "./unknown-send-reconciliation-core.js";

const IMESSAGE_SEND_STATUS_METHOD = "message.send_status";

type IMessageSendStatusResult = {
  guid?: unknown;
  send_state?: unknown;
};

type ReconciliationDeps = {
  createClient?: (params: {
    cliPath: string;
    dbPath?: string;
    remoteHost?: string;
  }) => Promise<IMessageRpcClient>;
  resolveRemoteHost?: typeof resolveIMessageRemoteHost;
};

export async function reconcileIMessageUnknownSend(
  ctx: ChannelMessageUnknownSendContext,
  deps: ReconciliationDeps = {},
): Promise<ChannelMessageUnknownSendReconciliationResult> {
  const attemptId = deriveIMessageAttemptId(ctx.queueId);
  const account = resolveIMessageAccount({ cfg: ctx.cfg, accountId: ctx.accountId });
  const cliPath = account.config.cliPath?.trim() || "imsg";
  const dbPath = account.config.dbPath?.trim();
  const timeoutMs = account.config.probeTimeoutMs ?? DEFAULT_IMESSAGE_PROBE_TIMEOUT_MS;
  let client: IMessageRpcClient | undefined;
  try {
    const resolveRemoteHost = deps.resolveRemoteHost ?? resolveIMessageRemoteHost;
    const remoteHost = await resolveRemoteHost({
      cliPath,
      remoteHost: account.config.remoteHost,
    });
    client = await (deps.createClient ?? createIMessageRpcClient)({
      cliPath,
      ...(dbPath ? { dbPath } : {}),
      ...(remoteHost ? { remoteHost } : {}),
    });
    const result = await client.request<IMessageSendStatusResult>(
      IMESSAGE_SEND_STATUS_METHOD,
      { guid: attemptId },
      { timeoutMs },
    );
    const guid = typeof result.guid === "string" ? result.guid.trim().toLowerCase() : "";
    if (guid !== attemptId) {
      return {
        status: "unresolved",
        error: "imsg returned a mismatched GUID for the tracked send attempt",
        retryable: false,
      };
    }
    const sendState = typeof result.send_state === "string" ? result.send_state.trim() : "";
    if (sendState === "sent" || sendState === "delivered") {
      const replyToId =
        ctx.effectiveReplyToId !== undefined ? ctx.effectiveReplyToId : ctx.replyToId;
      return {
        status: "sent",
        messageId: attemptId,
        receipt: createMessageReceiptFromOutboundResults({
          results: [{ channel: "imessage", messageId: attemptId }],
          kind: "text",
          ...(replyToId ? { replyToId } : {}),
        }),
      };
    }
    if (sendState === "failed") {
      return {
        status: "unresolved",
        error: "imsg reports that the tracked send attempt failed",
        retryable: false,
      };
    }
    return {
      status: "unresolved",
      error: "imsg has not confirmed the tracked send attempt",
      retryable: true,
    };
  } catch (error) {
    return {
      status: "unresolved",
      error: error instanceof Error ? error.message : String(error),
      retryable: true,
    };
  } finally {
    try {
      await client?.stop();
    } catch {
      // The status lookup is authoritative. Cleanup failure must not overwrite
      // either a confirmed send or the original reconciliation error.
    }
  }
}
