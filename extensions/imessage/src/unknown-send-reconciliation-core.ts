import { createHash } from "node:crypto";
import type { ChannelMessageDurableFinalAdapter } from "openclaw/plugin-sdk/channel-outbound";
import { resolveIMessageAccount } from "./accounts.js";
import {
  getCachedIMessagePrivateApiStatus,
  imessageRpcSupportsMethod,
} from "./private-api-status.js";

export const IMESSAGE_TRACKED_SEND_METHOD = "send.tracked";
const IMESSAGE_SEND_STATUS_METHOD = "message.send_status";

const UUID_URL_NAMESPACE = Buffer.from("6ba7b8119dad11d180b400c04fd430c8", "hex");
const IMESSAGE_ATTEMPT_NAME_PREFIX = "https://openclaw.ai/imessage/delivery-attempt/";

type DeferredDeliveryAdmission = NonNullable<
  ChannelMessageDurableFinalAdapter["admitDeferredDelivery"]
>;

function formatUuid(bytes: Buffer): string {
  const hex = bytes.toString("hex");
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)]
    .join("-")
    .toLowerCase();
}

/** Stable UUIDv5 used as the caller-owned iMessage GUID for one durable queue intent. */
export function deriveIMessageAttemptId(queueId: string): string {
  const digest = createHash("sha1")
    .update(UUID_URL_NAMESPACE)
    .update(`${IMESSAGE_ATTEMPT_NAME_PREFIX}${queueId}`)
    .digest()
    .subarray(0, 16);
  digest[6] = ((digest[6] ?? 0) & 0x0f) | 0x50;
  digest[8] = ((digest[8] ?? 0) & 0x3f) | 0x80;
  return formatUuid(digest);
}

export const resolveIMessageExactDeliveryAdmission: DeferredDeliveryAdmission = (ctx) => {
  const account = resolveIMessageAccount({ cfg: ctx.cfg, accountId: ctx.accountId });
  if (account.config.sendTransport === "applescript") {
    if (ctx.requireUnknownSendReconciliation !== true) {
      return { status: "allowed", automaticUnknownSendReconciliation: false };
    }
    return {
      status: "permanent_rejection",
      reason:
        "Required durable iMessage delivery needs bridge transport; sendTransport=applescript cannot provide exact send reconciliation.",
    };
  }
  const cliPath = account.config.cliPath?.trim() || "imsg";
  const status = getCachedIMessagePrivateApiStatus(cliPath);
  if (!status) {
    if (ctx.requireUnknownSendReconciliation !== true) {
      return { status: "allowed", automaticUnknownSendReconciliation: false };
    }
    return {
      status: "deferred",
      reason:
        "Required durable iMessage delivery is waiting for the imsg RPC capability probe; refresh channel status before retrying.",
    };
  }
  const missingMethods = [IMESSAGE_TRACKED_SEND_METHOD, IMESSAGE_SEND_STATUS_METHOD].filter(
    (method) => !imessageRpcSupportsMethod(status, method),
  );
  if (missingMethods.length > 0) {
    if (ctx.requireUnknownSendReconciliation !== true) {
      return { status: "allowed", automaticUnknownSendReconciliation: false };
    }
    return {
      status: "permanent_rejection",
      reason: `Required durable iMessage delivery needs imsg RPC methods ${missingMethods.join(
        " and ",
      )}; upgrade imsg and refresh its status probe before retrying.`,
    };
  }
  return { status: "allowed", automaticUnknownSendReconciliation: true };
};
