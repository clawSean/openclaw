import type { TelegramAccountConfig } from "openclaw/plugin-sdk/config-contracts";
import { describe, expect, it } from "vitest";
import { shouldIgnoreTelegramAgentUpdate } from "./agent-ignore-prefix.js";

const CHAT_ID = -1001234567890;

function accountConfig(overrides: TelegramAccountConfig = {}): TelegramAccountConfig {
  return {
    agentIgnorePrefixes: ["/ignore"],
    groups: { [String(CHAT_ID)]: { enabled: true } },
    ...overrides,
  };
}

function update(params: {
  kind?: "message" | "edited_message" | "channel_post" | "edited_channel_post";
  chatType?: "private" | "group" | "supergroup" | "channel";
  text?: string;
  caption?: string;
  threadId?: number;
  mediaGroupId?: string;
}) {
  const kind = params.kind ?? "message";
  return {
    [kind]: {
      chat: {
        id: params.chatType === "private" ? 123 : CHAT_ID,
        type: params.chatType ?? "supergroup",
      },
      ...(params.threadId === undefined ? {} : { message_thread_id: params.threadId }),
      ...(params.text === undefined ? {} : { text: params.text }),
      ...(params.caption === undefined ? {} : { caption: params.caption }),
      ...(params.mediaGroupId === undefined ? {} : { media_group_id: params.mediaGroupId }),
    },
  };
}

describe("shouldIgnoreTelegramAgentUpdate", () => {
  it.each([
    ["leading whitespace and ASCII case folding", { text: " \t/IgNoRe payload" }],
    ["current-bot mention", { text: "/ignore@cUrReNtBoT payload" }],
    ["caption", { caption: "/ignore payload" }],
    ["edited message", { kind: "edited_message", text: "/ignore payload" }],
    [
      "channel post",
      { kind: "channel_post", chatType: "channel", text: "/ignore payload" },
    ],
    [
      "edited channel post",
      { kind: "edited_channel_post", chatType: "channel", text: "/ignore payload" },
    ],
  ] as const satisfies ReadonlyArray<readonly [string, Parameters<typeof update>[0]]>)(
    "matches %s",
    (_label, fixture) => {
      expect(
        shouldIgnoreTelegramAgentUpdate({
          update: update(fixture),
          accountConfig: accountConfig(),
          botUsername: "CurrentBot",
        }),
      ).toBe(true);
    },
  );

  it.each([
    ["bare command", "/ignore"],
    ["whitespace-only payload", "/ignore \t "],
    ["near match", "/ignorefoo payload"],
    ["wrong bot", "/ignore@OtherBot payload"],
  ])("passes %s", (_label, text) => {
    expect(
      shouldIgnoreTelegramAgentUpdate({
        update: update({ text }),
        accountConfig: accountConfig(),
        botUsername: "CurrentBot",
      }),
    ).toBe(false);
  });

  it("uses text before caption and excludes DMs", () => {
    expect(
      shouldIgnoreTelegramAgentUpdate({
        update: update({ text: "ordinary", caption: "/ignore payload" }),
        accountConfig: accountConfig(),
      }),
    ).toBe(false);
    expect(
      shouldIgnoreTelegramAgentUpdate({
        update: update({ chatType: "private", text: "/ignore payload" }),
        accountConfig: accountConfig(),
      }),
    ).toBe(false);
  });

  it("leaves media-album admission undecided", () => {
    expect(
      shouldIgnoreTelegramAgentUpdate({
        update: update({
          caption: "/ignore payload",
          mediaGroupId: "album-1",
        }),
        accountConfig: accountConfig(),
      }),
    ).toBe(false);
  });

  it("uses the most-specific configured prefix scope", () => {
    const config = accountConfig({
      agentIgnorePrefixes: ["/account"],
      groups: {
        [String(CHAT_ID)]: {
          agentIgnorePrefixes: ["/group"],
          topics: { "42": { agentIgnorePrefixes: ["/topic"] } },
        },
      },
    });
    expect(
      shouldIgnoreTelegramAgentUpdate({
        update: update({ text: "/account payload" }),
        accountConfig: config,
      }),
    ).toBe(false);
    expect(
      shouldIgnoreTelegramAgentUpdate({
        update: update({ text: "/group payload" }),
        accountConfig: config,
      }),
    ).toBe(true);
    expect(
      shouldIgnoreTelegramAgentUpdate({
        update: update({ text: "/group payload", threadId: 42 }),
        accountConfig: config,
      }),
    ).toBe(false);
    expect(
      shouldIgnoreTelegramAgentUpdate({
        update: update({ text: "/topic payload", threadId: 42 }),
        accountConfig: config,
      }),
    ).toBe(true);
  });
});
