import type { AppAdapter } from "../app-adapter.js";
import { createTelegramSendMessageTool } from "./telegram-send-message-tool.js";
import {
  telegramReminderTriggerPromptEnricher,
  telegramThreadContextPromptEnricher
} from "./telegram-trigger-prompt-enricher.js";
import {
  telegramInboundMode
} from "./telegram-inbound-mode.js";
import {
  getTelegramClient,
  getTelegramHandlingOptions,
  normalizeTelegramAdapterOptions,
  type TelegramAdapterOptions
} from "./telegram-adapter-options.js";
import {
  initializeTelegramAdapter,
  registerTelegramWebhookRoute
} from "./telegram-adapter-handling.js";

export const telegramWebhookPath = "/adapters/telegram/webhook";

export function createTelegramAdapter(
  options: TelegramAdapterOptions
): AppAdapter | null {
  const normalizedOptions = normalizeTelegramAdapterOptions(options);

  if (normalizedOptions === null) {
    return null;
  }

  const client = getTelegramClient(normalizedOptions);
  const handlingOptions =
    normalizedOptions.inboundMode === telegramInboundMode.outboundOnly
      ? null
      : getTelegramHandlingOptions(normalizedOptions);

  return {
    name: "telegram",
    getTools() {
      return [
        createTelegramSendMessageTool({
          client
        })
      ];
    },
    getTriggerPromptEnrichers() {
      return [
        telegramThreadContextPromptEnricher,
        telegramReminderTriggerPromptEnricher
      ];
    },
    registerRoutes(app, context) {
      if (
        normalizedOptions.inboundMode !== telegramInboundMode.webhook ||
        !normalizedOptions.webhookSecret ||
        handlingOptions === null
      ) {
        return;
      }

      registerTelegramWebhookRoute(app, {
        execution: context.execution,
        client,
        threadStore: handlingOptions.threadStore,
        threadSelectionStore: handlingOptions.threadSelectionStore,
        webhookPath: telegramWebhookPath,
        webhookSecret: normalizedOptions.webhookSecret
      });
    },
    async initialize(context) {
      await handlingOptions?.threadSelectionStore.initialize();
      await initializeTelegramAdapter(
        normalizedOptions,
        client,
        handlingOptions === null
          ? null
          : {
              execution: context.execution,
              client,
              threadStore: handlingOptions.threadStore,
              threadSelectionStore: handlingOptions.threadSelectionStore
            },
        context,
        telegramWebhookPath
      );
    }
  };
}
