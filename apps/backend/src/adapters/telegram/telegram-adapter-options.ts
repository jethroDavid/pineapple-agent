import type { ThreadStore } from "../../threads/store/thread-store.js";
import type {
  TelegramThreadSelectionStore
} from "./telegram-thread-selection-store.js";
import {
  type TelegramBotClientLike,
  type TelegramSetWebhookRequest
} from "./telegram-bot-client.js";
import {
  telegramInboundMode,
  type TelegramInboundMode
} from "./telegram-inbound-mode.js";
import {
  assertValidHttpsWebhookBaseUrl,
  withTrailingSlash
} from "../shared/webhook-url.js";

const defaultTelegramPollIntervalMs = 1_000;
const defaultTelegramPollTimeoutSeconds = 1;
const defaultTelegramWebhookAllowedUpdates = ["message", "edited_message"] as const;
const defaultTelegramWebhookMaxConnections = 10;

export interface TelegramAdapterOptions {
  enabled?: boolean | null;
  botToken?: string | null;
  inboundMode?: TelegramInboundMode | null;
  allowedUpdates?: string[];
  webhookSecret?: string | null;
  webhookBaseUrl?: string | null;
  webhookMaxConnections?: number;
  pollIntervalMs?: number;
  pollTimeoutSeconds?: number;
  client?: TelegramBotClientLike;
  threadStore?: ThreadStore;
  threadSelectionStore?: TelegramThreadSelectionStore;
}

export interface TelegramInboundHandlingOptions {
  threadStore: ThreadStore;
  threadSelectionStore: TelegramThreadSelectionStore;
}

export interface NormalizedTelegramAdapterOptions {
  botToken: string;
  inboundMode: TelegramInboundMode;
  allowedUpdates: string[];
  webhookSecret: string | null;
  webhookBaseUrl: string | null;
  webhookMaxConnections: number;
  pollIntervalMs: number;
  pollTimeoutSeconds: number;
  client?: TelegramBotClientLike;
  threadStore?: ThreadStore;
  threadSelectionStore?: TelegramThreadSelectionStore;
}

export function normalizeTelegramAdapterOptions(
  options: TelegramAdapterOptions
): NormalizedTelegramAdapterOptions | null {
  const botToken = options.botToken?.trim() ?? null;
  const inboundMode = normalizeTelegramInboundMode(options.inboundMode);
  const webhookSecret = options.webhookSecret?.trim() ?? null;
  const webhookBaseUrl = options.webhookBaseUrl?.trim() ?? null;
  const allowedUpdates =
    options.allowedUpdates?.map((entry) => entry.trim()).filter(Boolean) ??
    [...defaultTelegramWebhookAllowedUpdates];
  const webhookMaxConnections =
    options.webhookMaxConnections ?? defaultTelegramWebhookMaxConnections;
  const pollIntervalMs = options.pollIntervalMs ?? defaultTelegramPollIntervalMs;
  const pollTimeoutSeconds = options.pollTimeoutSeconds ?? defaultTelegramPollTimeoutSeconds;
  const enabled = options.enabled ?? null;
  const hasWebhookConfig =
    webhookSecret !== null ||
    webhookBaseUrl !== null ||
    options.webhookMaxConnections !== undefined;
  const hasPollingConfig =
    options.pollIntervalMs !== undefined || options.pollTimeoutSeconds !== undefined;
  const hasAnyConfig =
    enabled === true ||
    botToken !== null ||
    inboundMode !== null ||
    hasWebhookConfig ||
    hasPollingConfig;

  if (enabled === false) {
    return null;
  }

  if (!hasAnyConfig) {
    return null;
  }

  if (botToken === null) {
    throw new Error("Telegram adapter requires TELEGRAM_BOT_TOKEN when enabled.");
  }

  const resolvedInboundMode = resolveTelegramInboundMode({
    inboundMode,
    hasWebhookConfig,
    hasPollingConfig
  });

  if (
    resolvedInboundMode === telegramInboundMode.webhook &&
    (webhookSecret === null || webhookBaseUrl === null)
  ) {
    throw new Error(
      "Telegram webhook mode requires both TELEGRAM_WEBHOOK_SECRET and TELEGRAM_WEBHOOK_BASE_URL."
    );
  }

  if (resolvedInboundMode === telegramInboundMode.webhook && hasPollingConfig) {
    throw new Error(
      "Telegram polling settings are only valid when TELEGRAM_INBOUND_MODE=polling."
    );
  }

  if (resolvedInboundMode === telegramInboundMode.polling && hasWebhookConfig) {
    throw new Error(
      "Telegram webhook settings are only valid when TELEGRAM_INBOUND_MODE=webhook."
    );
  }

  if (webhookBaseUrl !== null) {
    assertValidHttpsWebhookBaseUrl(webhookBaseUrl, "TELEGRAM_WEBHOOK_BASE_URL");
  }

  return {
    botToken,
    inboundMode: resolvedInboundMode,
    allowedUpdates,
    webhookSecret,
    webhookBaseUrl,
    webhookMaxConnections,
    pollIntervalMs,
    pollTimeoutSeconds,
    client: options.client,
    threadStore: options.threadStore,
    threadSelectionStore: options.threadSelectionStore
  };
}

export function getTelegramClient(
  options: NormalizedTelegramAdapterOptions
): TelegramBotClientLike {
  if (options.client === undefined) {
    throw new Error("Telegram adapter requires a prebuilt bot client dependency.");
  }

  return options.client;
}

export function getTelegramHandlingOptions(
  options: NormalizedTelegramAdapterOptions
): TelegramInboundHandlingOptions {
  if (options.threadStore === undefined) {
    throw new Error("Telegram inbound handling requires a shared ThreadStore dependency.");
  }

  if (options.threadSelectionStore === undefined) {
    throw new Error(
      "Telegram inbound handling requires a shared TelegramThreadSelectionStore dependency."
    );
  }

  return {
    threadStore: options.threadStore,
    threadSelectionStore: options.threadSelectionStore
  };
}

export function createDesiredTelegramWebhookRequest(options: {
  allowedUpdates: string[];
  webhookBaseUrl: string;
  webhookMaxConnections: number;
  webhookPath: string;
  webhookSecret: string;
}): TelegramSetWebhookRequest {
  return {
    url: new URL(options.webhookPath, withTrailingSlash(options.webhookBaseUrl)).toString(),
    secret_token: options.webhookSecret,
    allowed_updates: options.allowedUpdates,
    max_connections: options.webhookMaxConnections
  };
}

function normalizeTelegramInboundMode(
  inboundMode: TelegramAdapterOptions["inboundMode"]
): TelegramInboundMode | null {
  if (inboundMode === undefined || inboundMode === null) {
    return null;
  }

  const normalizedInboundMode = inboundMode.trim();

  if (normalizedInboundMode === "") {
    return null;
  }

  if (Object.values(telegramInboundMode).includes(normalizedInboundMode as TelegramInboundMode)) {
    return normalizedInboundMode as TelegramInboundMode;
  }

  throw new Error(
    "TELEGRAM_INBOUND_MODE must be one of outbound_only, polling, or webhook."
  );
}

function resolveTelegramInboundMode(options: {
  inboundMode: TelegramInboundMode | null;
  hasWebhookConfig: boolean;
  hasPollingConfig: boolean;
}): TelegramInboundMode {
  if (options.inboundMode !== null) {
    return options.inboundMode;
  }

  if (options.hasWebhookConfig || options.hasPollingConfig) {
    throw new Error(
      "Telegram inbound configuration requires TELEGRAM_INBOUND_MODE to be set to webhook, polling, or outbound_only."
    );
  }

  return telegramInboundMode.outboundOnly;
}
