// Telegram tests cover the ingress disposition contract for /ignore.
import type { Message } from "grammy/types";
import { describe, expect, it } from "vitest";
import { isTelegramIgnoredMessage, observeTelegramIgnoreCommand } from "./ignore-command.js";

// Telegram tokenizes a leading command as `/name` or `/name@bot` and marks exactly that
// span as `bot_command`; mirroring it keeps these fixtures honest about the real update.
function botCommandEntities(text: string): Message["entities"] {
  const command = /^\/[A-Za-z0-9_]+(?:@[A-Za-z0-9_]+)?/.exec(text);
  return command ? [{ type: "bot_command" as const, offset: 0, length: command[0].length }] : [];
}

function message(
  messageId: number,
  text: string,
  overrides: Record<string, unknown> = {},
): Message {
  return {
    chat: { id: 42, type: "group", title: "Ops" },
    message_id: messageId,
    date: 1_736_371_600 + messageId,
    from: { id: 7, is_bot: false, first_name: "Ada" },
    text,
    entities: botCommandEntities(text),
    ...overrides,
  } as Message;
}

const observe = (msg: Message, botUsername = "OurBot") =>
  observeTelegramIgnoreCommand(msg, botUsername);

describe("observeTelegramIgnoreCommand", () => {
  it("drops hidden text and answers the bare command with usage", () => {
    expect(observe(message(1, "/ignore keep this out"))).toBe("drop");
    expect(observe(message(2, "/ignore: keep this out"))).toBe("drop");
    expect(observe(message(3, "/IGNORE keep this out"))).toBe("drop");
    expect(observe(message(4, "/ignore"))).toBe("help");
    expect(observe(message(5, "/ignore   "))).toBe("help");
  });

  it("drops a captioned attachment the same way as text", () => {
    const photo = message(6, "", {
      text: undefined,
      // A real photo update carries no `entities`, only `caption_entities`.
      entities: undefined,
      caption: "/ignore my passport",
      caption_entities: botCommandEntities("/ignore my passport"),
      photo: [{ file_id: "f", file_unique_id: "u", width: 1, height: 1 }],
    });

    expect(observe(photo)).toBe("drop");
  });

  it("keeps ordinary messages that merely start with the word", () => {
    expect(observe(message(10, "/ignoreme"))).toBe("keep");
    expect(observe(message(11, "/ignored thing"))).toBe("keep");
    expect(observe(message(12, "please /ignore this", { entities: [] }))).toBe("keep");
  });

  it("keeps text that carries no leading bot_command entity", () => {
    // Telegram only tokenizes a command it recognizes at offset 0; a pasted or
    // forwarded-looking line that merely starts with the token is content.
    expect(observe(message(13, "/ignore secret", { entities: [] }))).toBe("keep");
    expect(
      observe(
        message(14, "look at /ignore secret", {
          entities: [{ type: "bot_command", offset: 8, length: 7 }],
        }),
      ),
    ).toBe("keep");
  });

  it("keeps a forwarded message that carries the origin's command entity", () => {
    const forwarded = message(15, "/ignore secret", {
      forward_origin: {
        type: "user",
        date: 1_736_371_000,
        sender_user: { id: 900, is_bot: false, first_name: "Nora" },
      },
    });

    expect(observe(forwarded)).toBe("keep");
  });

  it("matches the command addressed to our own bot and nobody else's", () => {
    expect(observe(message(20, "/ignore@OurBot secret"))).toBe("drop");
    expect(observe(message(21, "/ignore@ourbot"))).toBe("help");
    expect(observe(message(22, "/ignore@OtherBot secret"))).toBe("keep");
    expect(observeTelegramIgnoreCommand(message(23, "/ignore@SomeBot secret"))).toBe("keep");
  });

  it("treats removing the command in an edit as an intentional unignore", () => {
    expect(observe(message(30, "/ignore my api key"))).toBe("drop");

    const edited = message(30, "never mind, ordinary text", { edit_date: 1_736_372_000 });

    expect(observe(edited)).toBe("keep");
    expect(isTelegramIgnoredMessage(edited)).toBe(false);
  });

  it("leaves a deliberate reply ordinary while recognizing its ignored target", () => {
    const ignored = message(40, "/ignore my api key");
    expect(observe(ignored)).toBe("drop");

    const reply = message(41, "what did you make of that?", {
      entities: [],
      reply_to_message: ignored,
    });

    expect(observe(reply)).toBe("keep");
    expect(isTelegramIgnoredMessage(ignored)).toBe(true);
    expect(isTelegramIgnoredMessage(reply)).toBe(false);
  });

  it("recognizes an ignored reply target from its own text after a restart", () => {
    // A restart forgets the recorded ids, so the quoted payload has to speak for itself.
    const ignored = message(50, "/ignore my api key");

    expect(isTelegramIgnoredMessage(ignored, "OurBot")).toBe(true);
    expect(isTelegramIgnoredMessage(message(51, "ordinary text", { entities: [] }))).toBe(false);
  });
});
