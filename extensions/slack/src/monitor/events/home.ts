// Slack plugin module implements home behavior.
import type { SlackEventMiddlewareArgs } from "@slack/bolt";
import type { HomeView } from "@slack/types";
import { formatErrorMessage } from "openclaw/plugin-sdk/error-runtime";
import { danger } from "openclaw/plugin-sdk/runtime-env";
import { isRecord } from "openclaw/plugin-sdk/string-coerce-runtime";
import { mergeSlackAccountConfig } from "../../accounts.js";
import { validateSlackBlocksArray } from "../../blocks-input.js";
import { DEFAULT_SLACK_SUGGESTED_PROMPTS, type SlackMonitorContext } from "../context.js";
import type { SlackAppHomeOpenedEvent } from "../types.js";

// Slack Home tabs accept up to 100 blocks (message payloads cap at SLACK_MAX_BLOCKS).
const SLACK_APP_HOME_MAX_BLOCKS = 100;

// Configured Home views are presentation only. These are the interactive block
// and element types exposed by the pinned Slack Block Kit types; action markers
// also fail closed so unknown controls cannot enter the wildcard action route.
const SLACK_APP_HOME_INTERACTIVE_TYPES = new Set([
  "actions",
  "button",
  "channels_select",
  "checkboxes",
  "context_actions",
  "conversations_select",
  "datepicker",
  "datetimepicker",
  "email_text_input",
  "external_select",
  "feedback_buttons",
  "file_input",
  "icon_button",
  "input",
  "multi_channels_select",
  "multi_conversations_select",
  "multi_external_select",
  "multi_static_select",
  "multi_users_select",
  "number_input",
  "overflow",
  "plain_text_input",
  "radio_buttons",
  "rich_text_input",
  "static_select",
  "timepicker",
  "url_text_input",
  "users_select",
  "workflow_button",
]);

function assertSlackHomeViewDisplayOnly(value: unknown): void {
  if (Array.isArray(value)) {
    for (const entry of value) {
      assertSlackHomeViewDisplayOnly(entry);
    }
    return;
  }
  if (!isRecord(value)) {
    return;
  }
  if (typeof value.type === "string" && SLACK_APP_HOME_INTERACTIVE_TYPES.has(value.type)) {
    throw new Error(`Slack App Home view cannot contain interactive type "${value.type}"`);
  }
  if (
    Object.hasOwn(value, "action_id") ||
    Object.hasOwn(value, "dispatch_action") ||
    Object.hasOwn(value, "dispatch_action_config")
  ) {
    throw new Error("Slack App Home view cannot contain interactive action fields");
  }
  for (const child of Object.values(value)) {
    assertSlackHomeViewDisplayOnly(child);
  }
}

function buildSlackHomeView(slashCommandName?: string): HomeView {
  const startSessionText = slashCommandName
    ? `Send a DM, mention OpenClaw in a channel, or use \`/${slashCommandName}\` to start a session.`
    : "Send a DM or mention OpenClaw in a channel to start a session.";
  return {
    type: "home",
    callback_id: "openclaw:home",
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: "OpenClaw",
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: startSessionText,
        },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: "This Home tab is safe to show to any workspace member who opens the app.",
          },
        ],
      },
    ],
  };
}

function normalizeSlackHomeView(raw: unknown): HomeView {
  if (!isRecord(raw)) {
    throw new Error("Slack App Home view must be an object");
  }
  if (raw.type !== undefined && raw.type !== "home") {
    throw new Error('Slack App Home view type must be "home"');
  }
  assertSlackHomeViewDisplayOnly(raw.blocks);
  return {
    ...raw,
    type: "home",
    blocks: validateSlackBlocksArray(raw.blocks, { maxBlocks: SLACK_APP_HOME_MAX_BLOCKS }),
  } as HomeView;
}

// Inline views come from account-merged config only, so edits follow the normal
// config reload/account lifecycle; invalid content falls back to the built-in
// safe view instead of breaking the Home tab.
function resolveSlackCustomHomeView(ctx: SlackMonitorContext): HomeView | undefined {
  const view = mergeSlackAccountConfig(ctx.cfg, ctx.accountId).appHome?.view;
  if (view === undefined) {
    return undefined;
  }
  try {
    return normalizeSlackHomeView(view);
  } catch (err) {
    ctx.runtime.error?.(danger(`slack app home view config failed: ${formatErrorMessage(err)}`));
    return undefined;
  }
}

export function registerSlackHomeEvents(params: {
  ctx: SlackMonitorContext;
  slashCommandName?: string;
  trackEvent?: () => void;
}) {
  const { ctx, slashCommandName, trackEvent } = params;

  ctx.app.event(
    "app_home_opened",
    async ({ event, body }: SlackEventMiddlewareArgs<"app_home_opened">) => {
      if (ctx.shouldDropMismatchedSlackEvent(body)) {
        return;
      }
      trackEvent?.();

      const payload = event as SlackAppHomeOpenedEvent;
      if (!payload.user) {
        return;
      }
      if (payload.tab === "messages") {
        if (!payload.channel) {
          return;
        }
        const promptsSet = await ctx.setSlackSuggestedPrompts({
          channelId: payload.channel,
          title: "Try asking",
          prompts: DEFAULT_SLACK_SUGGESTED_PROMPTS,
        });
        // Both experiences can subscribe to App Home events. Assistant View
        // requires thread_ts here, so only Slack accepting this threadless
        // call proves Agent View and makes the durable mode write safe.
        if (promptsSet) {
          await ctx.recordSlackAgentView();
        }
        return;
      }

      const userId = payload.user;
      const publishHomeView = (view: HomeView) =>
        ctx.app.client.views.publish({
          token: ctx.botToken,
          user_id: userId,
          view,
        });

      const customView = resolveSlackCustomHomeView(ctx);
      if (customView) {
        try {
          await publishHomeView(customView);
          return;
        } catch (err) {
          // Slack still owns the complete payload contract; keep the Home tab
          // working when it rejects an otherwise display-only custom view.
          ctx.runtime.error?.(
            danger(`slack app home custom view publish failed: ${formatErrorMessage(err)}`),
          );
        }
      }
      await publishHomeView(buildSlackHomeView(slashCommandName));
    },
  );
}
