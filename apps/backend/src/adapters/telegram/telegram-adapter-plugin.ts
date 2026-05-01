import { resolve } from "node:path";

import { env } from "../../config/env.js";
import type { AdapterPlugin } from "../adapter-plugin.js";
import { resolveAdapterEnabled } from "../adapter-enabled.js";
import { TelegramBotClient, type TelegramBotClientLike } from "./telegram-bot-client.js";
import {
  FileTelegramThreadSelectionStore,
  type TelegramThreadSelectionStore
} from "./telegram-thread-selection-store.js";
import { createTelegramAdapter } from "./telegram-adapter.js";

const defaultTelegramThreadSelectionFilePath = resolve(
  process.cwd(),
  ".data/telegram/thread-selection.json"
);

interface TelegramAdapterPluginDependencies {
  client?: TelegramBotClientLike;
  threadSelectionStore?: TelegramThreadSelectionStore;
}

export const telegramAdapterPlugin: AdapterPlugin = {
  id: "telegram",
  startupOrder: 200,
  create(context) {
    const enabled = resolveAdapterEnabled({
      explicit: env.TELEGRAM_ENABLED,
      hasConfig: hasTelegramConfig()
    });
    const dependencies = enabled
      ? createTelegramDependencies(resolveTelegramDependencies(context.dependencies))
      : null;

    return createTelegramAdapter({
      enabled,
      botToken: env.TELEGRAM_BOT_TOKEN ?? null,
      inboundMode: env.TELEGRAM_INBOUND_MODE ?? null,
      allowedUpdates: env.TELEGRAM_ALLOWED_UPDATES,
      webhookSecret: env.TELEGRAM_WEBHOOK_SECRET ?? null,
      webhookBaseUrl: env.TELEGRAM_WEBHOOK_BASE_URL ?? null,
      webhookMaxConnections: env.TELEGRAM_WEBHOOK_MAX_CONNECTIONS,
      pollIntervalMs: env.TELEGRAM_POLL_INTERVAL_MS,
      pollTimeoutSeconds: env.TELEGRAM_POLL_TIMEOUT_SECONDS,
      client: dependencies?.client,
      threadStore: context.threadStore,
      threadSelectionStore: dependencies?.threadSelectionStore
    });
  }
};

function hasTelegramConfig(): boolean {
  return (
    env.TELEGRAM_BOT_TOKEN !== undefined ||
    env.TELEGRAM_INBOUND_MODE !== undefined ||
    env.TELEGRAM_ALLOWED_UPDATES !== undefined ||
    env.TELEGRAM_WEBHOOK_SECRET !== undefined ||
    env.TELEGRAM_WEBHOOK_BASE_URL !== undefined ||
    env.TELEGRAM_WEBHOOK_MAX_CONNECTIONS !== undefined ||
    env.TELEGRAM_POLL_INTERVAL_MS !== undefined ||
    env.TELEGRAM_POLL_TIMEOUT_SECONDS !== undefined
  );
}

function resolveTelegramDependencies(input: unknown): TelegramAdapterPluginDependencies {
  if (input === undefined) {
    return {};
  }

  if (typeof input !== "object" || input === null) {
    throw new Error("Telegram adapter plugin dependencies must be an object.");
  }

  return input as TelegramAdapterPluginDependencies;
}

function createTelegramDependencies(
  dependencies: TelegramAdapterPluginDependencies
): {
  client: TelegramBotClientLike;
  threadSelectionStore: TelegramThreadSelectionStore;
} | null {
  if (env.TELEGRAM_BOT_TOKEN === undefined) {
    return null;
  }

  return {
    client:
      dependencies.client ??
      new TelegramBotClient({
        botToken: env.TELEGRAM_BOT_TOKEN
      }),
    threadSelectionStore:
      dependencies.threadSelectionStore ??
      new FileTelegramThreadSelectionStore({
        filePath: defaultTelegramThreadSelectionFilePath
      })
  };
}
