import type {
  TelegramAccountConfig,
  TelegramGroupConfig,
  TelegramTopicConfig,
} from "openclaw/plugin-sdk/config-contracts";
import { resolveTelegramScopedGroupConfig } from "./group-config-helpers.js";

type TelegramIngressMessage = {
  chat?: { id?: number; type?: string };
  message_thread_id?: number;
  media_group_id?: string;
  text?: string;
  caption?: string;
};

type TelegramIngressUpdate = {
  message?: TelegramIngressMessage;
  edited_message?: TelegramIngressMessage;
  channel_post?: TelegramIngressMessage;
  edited_channel_post?: TelegramIngressMessage;
};

function asciiLower(value: string): string {
  return value.replace(/[A-Z]/gu, (character) => character.toLowerCase());
}

function resolvePrefixes(params: {
  accountConfig: TelegramAccountConfig;
  groupConfig?: TelegramGroupConfig;
  topicConfig?: TelegramTopicConfig;
}): string[] | undefined {
  return (
    params.topicConfig?.agentIgnorePrefixes ??
    params.groupConfig?.agentIgnorePrefixes ??
    params.accountConfig.agentIgnorePrefixes
  );
}

function hasIgnoredPayload(params: {
  content: string;
  prefix: string;
  botUsername?: string;
}): boolean {
  const content = params.content.trimStart();
  const prefix = params.prefix.trim();
  if (!prefix) {
    return false;
  }
  const normalizedContent = asciiLower(content);
  const normalizedPrefix = asciiLower(prefix);
  if (!normalizedContent.startsWith(normalizedPrefix)) {
    return false;
  }

  let remainder = content.slice(prefix.length);
  if (remainder.startsWith("@")) {
    const mention = /^@([A-Za-z0-9_]+)/u.exec(remainder);
    const botUsername = params.botUsername?.replace(/^@/u, "").trim();
    if (!mention || !botUsername || asciiLower(mention[1]) !== asciiLower(botUsername)) {
      return false;
    }
    remainder = remainder.slice(mention[0].length);
  }
  if (remainder && !/^\s/u.test(remainder)) {
    return false;
  }
  return remainder.trim().length > 0;
}

export function shouldIgnoreTelegramAgentUpdate(params: {
  update: TelegramIngressUpdate;
  accountConfig: TelegramAccountConfig;
  botUsername?: string;
}): boolean {
  const message =
    params.update.message ??
    params.update.edited_message ??
    params.update.channel_post ??
    params.update.edited_channel_post;
  const chatId = message?.chat?.id;
  const chatType = message?.chat?.type;
  if (
    typeof chatId !== "number" ||
    (chatType !== "group" && chatType !== "supergroup" && chatType !== "channel")
  ) {
    return false;
  }
  const content = message.text ?? message.caption;
  // Album admission remains a separate product decision; preserve the existing
  // media-group buffer path rather than silently choosing per-item suppression.
  if (message.media_group_id || typeof content !== "string") {
    return false;
  }
  const { groupConfig, topicConfig } = resolveTelegramScopedGroupConfig(
    params.accountConfig,
    chatId,
    message.message_thread_id,
  );
  const prefixes = resolvePrefixes({
    accountConfig: params.accountConfig,
    groupConfig,
    topicConfig,
  });
  return (
    prefixes?.some((prefix) =>
      hasIgnoredPayload({
        content,
        prefix,
        ...(params.botUsername ? { botUsername: params.botUsername } : {}),
      }),
    ) ?? false
  );
}
