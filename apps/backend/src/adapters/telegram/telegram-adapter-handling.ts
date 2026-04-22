import type { FastifyInstance } from "fastify";

import type {
  AppAdapterInitContext,
  AppAdapterRouteContext
} from "../app-adapter.js";
import type { ThreadStore } from "../../threads/store/thread-store.js";
import type {
  TelegramThreadSelectionStore
} from "./telegram-thread-selection-store.js";
import {
  type TelegramBotCommand,
  type TelegramBotClientLike
} from "./telegram-bot-client.js";
import {
  telegramInboundMode,
  type TelegramInboundMode
} from "./telegram-inbound-mode.js";
import {
  processTelegramUpdate,
  type TelegramUpdateProcessorOptions
} from "./telegram-update-processor.js";
import { telegramWebhookSecretHeader } from "./telegram-webhook.js";
import {
  createDesiredTelegramWebhookRequest,
  type NormalizedTelegramAdapterOptions
} from "./telegram-adapter-options.js";
import { trace, traceError } from "../../utils/trace.js";

const defaultTelegramCommands: TelegramBotCommand[] = [
  {
    command: "new",
    description: "Start a new Pineapple thread"
  },
  {
    command: "list",
    description: "List recent Pineapple threads"
  },
  {
    command: "select",
    description: "Select a Pineapple thread"
  },
  {
    command: "current",
    description: "Show the current Pineapple thread"
  },
  {
    command: "help",
    description: "Show Pineapple bot commands"
  }
];

interface TelegramRuntimeHandlingOptions {
  execution: AppAdapterInitContext["execution"];
  client: TelegramBotClientLike;
  threadStore: ThreadStore;
  threadSelectionStore: TelegramThreadSelectionStore;
}

interface RegisterTelegramWebhookRouteOptions {
  execution: AppAdapterRouteContext["execution"];
  client: TelegramBotClientLike;
  threadStore: ThreadStore;
  threadSelectionStore: TelegramThreadSelectionStore;
  webhookPath: string;
  webhookSecret: string;
}

export async function initializeTelegramAdapter(
  options: NormalizedTelegramAdapterOptions,
  client: TelegramBotClientLike,
  handlingOptions: TelegramRuntimeHandlingOptions | null,
  context: AppAdapterInitContext,
  webhookPath: string
): Promise<void> {
  trace("telegram", "adapter initialize", {
    inboundMode: options.inboundMode
  });
  await reconcileTelegramCommands(client, context);

  if (options.inboundMode === telegramInboundMode.polling) {
    const resolvedHandlingOptions = requireTelegramHandlingOptions(
      handlingOptions,
      options.inboundMode
    );
    await client.deleteWebhook({
      drop_pending_updates: false
    });
    context.logger.info(
      {
        pollIntervalMs: options.pollIntervalMs,
        pollTimeoutSeconds: options.pollTimeoutSeconds
      },
      "Telegram adapter initialized in polling mode."
    );
    startTelegramPolling(options, client, resolvedHandlingOptions, context);
    return;
  }

  if (options.inboundMode === telegramInboundMode.outboundOnly) {
    context.logger.info("Telegram adapter initialized in outbound-only mode.");
    return;
  }

  const desiredWebhook = createDesiredTelegramWebhookRequest({
    allowedUpdates: options.allowedUpdates,
    webhookBaseUrl: options.webhookBaseUrl!,
    webhookMaxConnections: options.webhookMaxConnections,
    webhookPath,
    webhookSecret: options.webhookSecret!
  });
  await client.setWebhook(desiredWebhook);
  context.logger.info(
    {
      url: desiredWebhook.url,
      allowedUpdates: desiredWebhook.allowed_updates,
      maxConnections: desiredWebhook.max_connections
    },
    "Telegram webhook ensured."
  );
}

export function registerTelegramWebhookRoute(
  app: FastifyInstance,
  options: RegisterTelegramWebhookRouteOptions
): void {
  trace("telegram", "register webhook route", {
    path: options.webhookPath
  });
  app.post(options.webhookPath, (request, reply) => {
    if (request.headers[telegramWebhookSecretHeader] !== options.webhookSecret) {
      return reply.code(401).send({
        error: "Invalid Telegram webhook secret."
      });
    }

    reply.code(200).send({
      ok: true
    });
    trace("telegram", "webhook delivery accepted");

    void processTelegramWebhookDelivery(
      request.body,
      createTelegramUpdateProcessorOptions(options, request.log)
    );
  });
}

function requireTelegramHandlingOptions(
  options: TelegramRuntimeHandlingOptions | null,
  inboundMode: TelegramInboundMode
): TelegramRuntimeHandlingOptions {
  if (options === null) {
    throw new Error(
      `Telegram adapter is missing inbound handling dependencies for ${inboundMode} mode.`
    );
  }

  return options;
}

async function reconcileTelegramCommands(
  client: TelegramBotClientLike,
  context: AppAdapterInitContext
): Promise<void> {
  const currentCommands = await client.getMyCommands();

  if (telegramCommandsEqual(currentCommands, defaultTelegramCommands)) {
    context.logger.info("Telegram bot commands already match desired configuration.");
    return;
  }

  await client.setMyCommands(defaultTelegramCommands);
  context.logger.info(
    {
      commands: defaultTelegramCommands.map((command) => command.command)
    },
    "Telegram bot commands configured."
  );
}

function telegramCommandsEqual(
  left: TelegramBotCommand[],
  right: TelegramBotCommand[]
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((command, index) => {
    const other = right[index];
    return (
      other !== undefined &&
      command.command === other.command &&
      command.description === other.description
    );
  });
}

async function processTelegramWebhookDelivery(
  body: unknown,
  options: TelegramUpdateProcessorOptions
): Promise<void> {
  try {
    await processTelegramUpdate(body, options);
  } catch (error) {
    traceError("telegram", "webhook background processing failed", error);
    options.logger.error(
      {
        ...(error instanceof Error ? { err: error } : { error })
      },
      "Telegram webhook background processing failed."
    );
  }
}

function startTelegramPolling(
  options: NormalizedTelegramAdapterOptions,
  client: TelegramBotClientLike,
  handlingOptions: TelegramRuntimeHandlingOptions,
  context: AppAdapterInitContext
): void {
  let nextOffset: number | undefined;

  void (async () => {
    for (;;) {
      try {
        const updates = await client.getUpdates({
          offset: nextOffset,
          timeout: options.pollTimeoutSeconds,
          allowed_updates: options.allowedUpdates
        });

        for (const update of updates) {
          trace("telegram", "polling update received");
          nextOffset = (await processTelegramUpdate(
            update,
            createTelegramUpdateProcessorOptions(handlingOptions, context.logger)
          )) + 1;
        }
      } catch (error) {
        traceError("telegram", "polling cycle failed", error);
        context.logger.error(
          {
            ...(error instanceof Error ? { err: error } : { error })
          },
          "Telegram polling cycle failed."
        );
      }

      await new Promise((resolve) => setTimeout(resolve, options.pollIntervalMs));
    }
  })();
}

function createTelegramUpdateProcessorOptions(
  options: {
    execution: AppAdapterRouteContext["execution"];
    client: TelegramBotClientLike;
    threadStore: ThreadStore;
    threadSelectionStore: TelegramThreadSelectionStore;
  },
  logger: TelegramUpdateProcessorOptions["logger"]
): TelegramUpdateProcessorOptions {
  return {
    client: options.client,
    execution: options.execution,
    logger,
    threadStore: options.threadStore,
    threadSelectionStore: options.threadSelectionStore
  };
}
