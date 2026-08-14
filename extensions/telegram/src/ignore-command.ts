// Context hygiene: `/ignore <text>` keeps one Telegram message out of the agent's
// context. Ingress owns detection with the per-update bot identity; the message cache
// applies the same entity-aware predicate only to embedded or legacy persisted copies.
import type { Message } from "grammy/types";
import { getTelegramTextParts } from "./bot/body-helpers.js";

// Telegram command tokens are `/name` or `/name@bot`, so `/ignoreme` is a different
// command and `/ignore@OtherBot` belongs to that bot.
const TELEGRAM_IGNORE_COMMAND_RE = /^\/ignore(?:@([a-z0-9_]+))?$/i;
export const TELEGRAM_IGNORE_HELP_TEXT =
  "Use /ignore <message> to keep this message out of the bot's context. Replying to it may include it again.";

/** `drop` and `help` never reach the agent; `keep` is ordinary processing. */
export type TelegramIgnoreDisposition = "drop" | "help" | "keep";

export function matchTelegramIgnoreCommand(
  msg: Message,
  botUsername?: string,
): Exclude<TelegramIgnoreDisposition, "keep"> | undefined {
  // A forward keeps the origin's `bot_command` entities: it is content the human
  // relayed, not a command they typed. Dropping it would end their turn with nothing
  // delivered and nothing explaining why.
  if (msg.forward_origin) {
    return undefined;
  }
  const { text, entities } = getTelegramTextParts(msg);
  // Telegram only honors a `bot_command` entity at offset 0; everything else is text.
  const command = entities.find((entity) => entity.type === "bot_command" && entity.offset === 0);
  if (!command) {
    return undefined;
  }
  const addressed = TELEGRAM_IGNORE_COMMAND_RE.exec(text.slice(0, command.length));
  if (!addressed) {
    return undefined;
  }
  // An addressed command needs our own username; an unknown identity stays inert.
  const target = addressed[1]?.toLowerCase();
  if (target && target !== botUsername?.trim().toLowerCase()) {
    return undefined;
  }
  return text.slice(command.length).trim() ? "drop" : "help";
}

/**
 * Ingress decision for one inbound update, using the per-update bot identity.
 */
export function observeTelegramIgnoreCommand(
  msg: Message,
  botUsername?: string,
): TelegramIgnoreDisposition {
  return matchTelegramIgnoreCommand(msg, botUsername) ?? "keep";
}

/** True when a message must never enter the durable message cache. */
export function isTelegramIgnoredMessage(msg: Message, botUsername?: string): boolean {
  return matchTelegramIgnoreCommand(msg, botUsername) !== undefined;
}
