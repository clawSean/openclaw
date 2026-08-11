import type {
  ChannelMessageDurableFinalAdapter,
  ChannelMessageUnknownSendContext,
} from "openclaw/plugin-sdk/channel-outbound";
import { describe, expect, it, vi } from "vitest";
import type { IMessageRpcClient } from "./client.js";
import { setCachedIMessagePrivateApiStatus } from "./private-api-status.js";
import {
  deriveIMessageAttemptId,
  resolveIMessageExactDeliveryAdmission,
} from "./unknown-send-reconciliation-core.js";
import { reconcileIMessageUnknownSend } from "./unknown-send-reconciliation.js";

type AdmissionContext = Parameters<
  NonNullable<ChannelMessageDurableFinalAdapter["admitDeferredDelivery"]>
>[0];

function admissionContext(params?: {
  cliPath?: string;
  sendTransport?: "auto" | "bridge" | "applescript";
  requireUnknownSendReconciliation?: boolean;
}): AdmissionContext {
  return {
    cfg: {
      channels: {
        imessage: {
          cliPath: params?.cliPath,
          sendTransport: params?.sendTransport,
        },
      },
    },
    channel: "imessage",
    to: "+15555550123",
    phase: "live",
    ...(params?.requireUnknownSendReconciliation ? { requireUnknownSendReconciliation: true } : {}),
  };
}

function unknownSendContext(queueId = "cron:daily:report"): ChannelMessageUnknownSendContext {
  return {
    cfg: { channels: { imessage: { cliPath: "imsg-reconcile-test" } } },
    queueId,
    channel: "imessage",
    to: "+15555550123",
    enqueuedAt: 1,
    retryCount: 1,
    effectiveReplyToId: "reply-guid",
    payloads: [{ text: "once" }],
  };
}

function createClient(result: Record<string, unknown>) {
  const request = vi.fn(async () => result);
  const stop = vi.fn(async () => {});
  return {
    client: { request, stop } as unknown as IMessageRpcClient,
    request,
    stop,
  };
}

describe("iMessage exact unknown-send reconciliation", () => {
  it("derives a stable UUIDv5 from any durable queue id", () => {
    const first = deriveIMessageAttemptId("cron:daily:report");

    expect(first).toBe(deriveIMessageAttemptId("cron:daily:report"));
    expect(first).not.toBe(deriveIMessageAttemptId("cron:daily:report:other"));
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("leaves ordinary iMessage sends admitted without tracked-send support", () => {
    expect(resolveIMessageExactDeliveryAdmission(admissionContext())).toEqual({
      status: "allowed",
      automaticUnknownSendReconciliation: false,
    });
  });

  it("enables automatic exact delivery only after both marker methods are cached", () => {
    const cliPath = "imsg-admission-automatic-ready";
    setCachedIMessagePrivateApiStatus(cliPath, {
      available: true,
      v2Ready: true,
      selectors: {},
      rpcMethods: ["send.tracked", "message.send_status"],
    });

    expect(resolveIMessageExactDeliveryAdmission(admissionContext({ cliPath }))).toEqual({
      status: "allowed",
      automaticUnknownSendReconciliation: true,
    });
  });

  it("defers required exact delivery until the imsg capability probe is authoritative", () => {
    expect(
      resolveIMessageExactDeliveryAdmission(
        admissionContext({
          cliPath: "imsg-admission-unprobed",
          requireUnknownSendReconciliation: true,
        }),
      ),
    ).toMatchObject({ status: "deferred" });
  });

  it("rejects required exact delivery when transport or probed imsg capabilities are insufficient", () => {
    expect(
      resolveIMessageExactDeliveryAdmission(
        admissionContext({
          cliPath: "imsg-admission-applescript",
          sendTransport: "applescript",
          requireUnknownSendReconciliation: true,
        }),
      ),
    ).toMatchObject({ status: "permanent_rejection" });

    const cliPath = "imsg-admission-confirmed-missing";
    setCachedIMessagePrivateApiStatus(cliPath, {
      available: true,
      v2Ready: true,
      selectors: {},
      rpcMethods: ["message.send_status"],
    });
    expect(
      resolveIMessageExactDeliveryAdmission(
        admissionContext({
          cliPath,
          requireUnknownSendReconciliation: true,
        }),
      ),
    ).toMatchObject({ status: "permanent_rejection" });
  });

  it("admits required exact delivery only when imsg advertises both marker methods", () => {
    const cliPath = "imsg-admission-ready";
    setCachedIMessagePrivateApiStatus(cliPath, {
      available: true,
      v2Ready: true,
      selectors: {},
      rpcMethods: ["send.tracked", "message.send_status"],
    });

    expect(
      resolveIMessageExactDeliveryAdmission(
        admissionContext({ cliPath, requireUnknownSendReconciliation: true }),
      ),
    ).toEqual({ status: "allowed", automaticUnknownSendReconciliation: true });
  });

  it.each(["sent", "delivered"])("accepts an exact %s status as sent", async (sendState) => {
    const ctx = unknownSendContext();
    const attemptId = deriveIMessageAttemptId(ctx.queueId);
    const rpc = createClient({ guid: attemptId.toUpperCase(), send_state: sendState });

    const result = await reconcileIMessageUnknownSend(ctx, {
      createClient: async () => rpc.client,
      resolveRemoteHost: async () => undefined,
    });

    expect(result).toMatchObject({
      status: "sent",
      messageId: attemptId,
      receipt: {
        primaryPlatformMessageId: attemptId,
        replyToId: "reply-guid",
      },
    });
    expect(rpc.request).toHaveBeenCalledWith(
      "message.send_status",
      { guid: attemptId },
      { timeoutMs: 10_000 },
    );
    expect(rpc.stop).toHaveBeenCalledOnce();
  });

  it("preserves a confirmed send when RPC cleanup rejects", async () => {
    const ctx = unknownSendContext();
    const attemptId = deriveIMessageAttemptId(ctx.queueId);
    const request = vi.fn(async () => ({ guid: attemptId, send_state: "sent" }));
    const stop = vi.fn(async () => {
      throw new Error("cleanup failed");
    });

    const result = await reconcileIMessageUnknownSend(ctx, {
      createClient: async () => ({ request, stop }) as unknown as IMessageRpcClient,
      resolveRemoteHost: async () => undefined,
    });

    expect(result).toMatchObject({ status: "sent", messageId: attemptId });
    expect(stop).toHaveBeenCalledOnce();
  });

  it.each([
    { response: { send_state: "pending" }, retryable: false },
    { response: { guid: "different-guid", send_state: "sent" }, retryable: false },
    { response: { send_state: "failed" }, retryable: false },
  ])("keeps unproven status unresolved", async ({ response, retryable }) => {
    const ctx = unknownSendContext();
    const attemptId = deriveIMessageAttemptId(ctx.queueId);
    const rpc = createClient({ guid: attemptId, ...response });

    const result = await reconcileIMessageUnknownSend(ctx, {
      createClient: async () => rpc.client,
      resolveRemoteHost: async () => undefined,
    });

    expect(result.status).toBe("unresolved");
    if (result.status === "unresolved") {
      expect(result.retryable).toBe(response.send_state === "pending" ? true : retryable);
    }
    expect(rpc.stop).toHaveBeenCalledOnce();
  });

  it("treats status lookup failures as retryable and still stops the client", async () => {
    const request = vi.fn(async () => {
      throw new Error("status unavailable");
    });
    const stop = vi.fn(async () => {});

    const result = await reconcileIMessageUnknownSend(unknownSendContext(), {
      createClient: async () => ({ request, stop }) as unknown as IMessageRpcClient,
      resolveRemoteHost: async () => undefined,
    });

    expect(result).toEqual({
      status: "unresolved",
      error: "status unavailable",
      retryable: true,
    });
    expect(stop).toHaveBeenCalledOnce();
  });
});
