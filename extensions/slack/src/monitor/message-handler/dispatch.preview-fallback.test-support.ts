import { createRequireRecord } from "openclaw/plugin-sdk/test-fixtures";
import { expect, vi } from "vitest";

const requireRecord = createRequireRecord("object", "label-not-object");
const noop = () => {};
export const noopAsync = async () => {};

export class TestSlackStreamNotDeliveredError extends Error {
  readonly pendingText: string;
  readonly slackCode: string;

  constructor(pendingText: string, slackCode: string) {
    super(`slack-stream not delivered: ${slackCode}`);
    this.name = "SlackStreamNotDeliveredError";
    this.pendingText = pendingText;
    this.slackCode = slackCode;
  }
}

export function createSlackPlatformError(
  error: string,
  details?: { needed?: string; provided?: string },
) {
  return Object.assign(new Error(`An API error occurred: ${error}`), {
    code: "slack_webapi_platform_error",
    data: { ok: false, error, ...details },
  });
}

export function expectRecordFields(
  record: Record<string, unknown>,
  fields: Record<string, unknown>,
) {
  for (const [key, value] of Object.entries(fields)) {
    expect(record[key]).toEqual(value);
  }
}

export function planUpdate(title: string) {
  return { type: "plan_update", title };
}

export function taskUpdate(
  id: unknown,
  title: string,
  status: "pending" | "in_progress" | "complete" | "error",
  extra?: Record<string, unknown>,
) {
  return { type: "task_update", id, title, status, ...extra };
}

export function contentTaskId(prefix: string) {
  return expect.stringMatching(new RegExp(`^${prefix}_[a-f0-9]{8}_1$`, "u"));
}

export function createDraftStreamStub() {
  return {
    update: vi.fn(),
    flush: vi.fn(noopAsync),
    clear: vi.fn(noopAsync),
    discardPending: vi.fn(noopAsync),
    seal: vi.fn(noopAsync),
    stop: vi.fn(noop),
    forceNewMessage: vi.fn(),
    dropDetachedMessages: vi.fn(noopAsync),
    finalizeMessage: vi.fn(async (_messageId: string, editFinal: () => Promise<void>) => {
      await editFinal();
      return true;
    }),
    messageId: (): string | undefined => "171234.567",
    channelId: () => "C123",
  };
}

export function draftUpdateTexts(draftStream: ReturnType<typeof createDraftStreamStub>): string[] {
  return draftStream.update.mock.calls.map(([update]) => {
    if (typeof update === "string") {
      return update;
    }
    return requireRecord(update, "draft update").text as string;
  });
}
