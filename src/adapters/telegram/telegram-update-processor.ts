import type { FastifyBaseLogger } from "fastify";

import type { ThreadStore } from "../../threads/store/thread-store.js";
import type { Thread } from "../../threads/domain/thread.js";
import { applyThreadMetadataPatch } from "../../threads/domain/thread.js";
import type { AppExecutionService } from "../../execution/pipeline/service.js";
import type { ExecutionTurnResult } from "../../execution/execution-contracts.js";
import type {
  TelegramThreadSelectionStore
} from "./telegram-thread-selection-store.js";
import type { TelegramBotClientLike } from "./telegram-bot-client.js";
import {
  createTelegramTriggerEvent,
  getTelegramDeliveryContextKey,
  normalizeTelegramWebhookUpdate,
  telegramCommandName,
  type TelegramAcceptedWebhookUpdate
} from "./telegram-webhook.js";
import { trace, traceError } from "../../utils/trace.js";

const telegramSendMessageToolName = "telegram_send_message";
const telegramListLimit = 10;
const telegramSelectSearchLimit = 50;

export interface TelegramUpdateProcessorOptions {
  client: TelegramBotClientLike;
  execution: AppExecutionService | null;
  logger: FastifyBaseLogger;
  threadStore: ThreadStore;
  threadSelectionStore: TelegramThreadSelectionStore;
}

export async function processTelegramUpdate(
  update: unknown,
  options: TelegramUpdateProcessorOptions
): Promise<number> {
  const result = normalizeTelegramWebhookUpdate(update);

  if (result.kind === "ignored") {
    trace("telegram", "update ignored", {
      updateId: result.updateId,
      eventType: result.eventType,
      reason: result.reason
    });
    options.logger.info(
      {
        updateId: result.updateId,
        eventType: result.eventType,
        reason: result.reason
      },
      "Telegram update ignored."
    );
    return result.updateId;
  }

  trace("telegram", "update accepted", {
    updateId: result.updateId,
    eventType: result.eventType,
    hasCommand: result.command !== null
  });
  await processTelegramAcceptedUpdate(result, options);
  return result.updateId;
}

async function processTelegramAcceptedUpdate(
  result: TelegramAcceptedWebhookUpdate,
  options: TelegramUpdateProcessorOptions
): Promise<void> {
  if (result.command !== null) {
    void sendTelegramCommandReply(result, options);
    return;
  }

  if (options.execution === null) {
    throw new Error("Execution service is not configured. Set OPENAI_API_KEY and OPENAI_MODEL first.");
  }

  const threadId = await resolveTelegramThreadId(result, options);
  await persistTelegramThreadContext(threadId, result, options);
  const triggerEvent = createTelegramTriggerEvent({
    update: result,
    threadId
  });
  trace("telegram", "enqueue trigger", {
    updateId: result.updateId,
    triggerId: triggerEvent.trigger_id,
    threadId
  });

  options.execution.enqueueTrigger(triggerEvent, (error) => {
    traceError("telegram", "trigger failed", error, {
      updateId: result.updateId,
      triggerId: triggerEvent.trigger_id,
      threadId
    });
    options.logger.error(
      {
        ...(error instanceof Error ? { err: error } : { error }),
        triggerId: triggerEvent.trigger_id,
        threadId,
        updateId: result.updateId
      },
      "Telegram webhook trigger failed."
    );
  }, (runResult) => {
    trace("telegram", "trigger finished", {
      updateId: result.updateId,
      triggerId: triggerEvent.trigger_id,
      executionId: runResult.execution.executionId,
      status: runResult.execution.status
    });
    void sendTelegramRunReplyFallback(runResult, result, options);
  });
}

async function sendTelegramCommandReply(
  update: TelegramAcceptedWebhookUpdate,
  options: TelegramUpdateProcessorOptions
): Promise<void> {
  try {
    const commandReply = await handleTelegramCommand(update, options);

    await options.client.sendMessage({
      chat_id: update.message.chatId,
      text: commandReply.text
    });
  } catch (error) {
    traceError("telegram", "command reply failed", error, {
      updateId: update.updateId,
      command: update.command?.name
    });
    options.logger.error(
      {
        ...(error instanceof Error ? { err: error } : { error }),
        updateId: update.updateId,
        command: update.command?.name
      },
      "Telegram command reply failed."
    );
  }
}

async function sendTelegramRunReplyFallback(
  runResult: ExecutionTurnResult,
  update: TelegramAcceptedWebhookUpdate,
  options: TelegramUpdateProcessorOptions
): Promise<void> {
  if (runResult.execution.status !== "completed" || runResult.pendingDecision !== null) {
    return;
  }

  if (runResult.usedTools.some((tool) => tool.name === telegramSendMessageToolName)) {
    return;
  }

  const text = (runResult.finalOutput ?? "").trim();

  if (!text) {
    return;
  }

  try {
    await options.client.sendMessage({
      chat_id: update.message.chatId,
      text
    });
  } catch (error) {
    traceError("telegram", "fallback reply failed", error, {
      updateId: update.updateId,
      triggerId: `telegram:update:${update.updateId}`
    });
    options.logger.error(
      {
        ...(error instanceof Error ? { err: error } : { error }),
        triggerId: `telegram:update:${update.updateId}`,
        updateId: update.updateId
      },
      "Telegram fallback reply failed."
    );
  }
}

async function handleTelegramCommand(
  update: TelegramAcceptedWebhookUpdate,
  options: TelegramUpdateProcessorOptions
): Promise<{ text: string }> {
  const command = update.command!;
  const contextKey = getTelegramDeliveryContextKey(update.message);

  switch (command.name) {
    case telegramCommandName.help:
      return {
        text: createTelegramHelpText()
      };
    case telegramCommandName.new: {
      const requestedTitle = command.args.trim();
      const thread = await options.threadStore.create({
        ...(requestedTitle ? { title: requestedTitle } : {})
      });
      await options.threadSelectionStore.setCurrent(contextKey, thread.threadId);

      return {
        text: [
          "Started a new Pineapple thread.",
          `Title: ${thread.title ?? "Untitled"}`,
          `Current: ${thread.threadId}`
        ].join("\n")
      };
    }
    case telegramCommandName.current: {
      const currentThreadId = await getCurrentTelegramThreadId(
        options.threadSelectionStore,
        options.threadStore,
        contextKey
      );

      if (currentThreadId === null) {
        return {
          text: "No current Pineapple thread in this chat yet. Use /new or send a message."
        };
      }

      return {
        text: `Current Pineapple thread: ${currentThreadId}`
      };
    }
    case telegramCommandName.list: {
      const threads = await options.threadStore.listRecent(telegramListLimit);

      if (threads.length === 0) {
        return {
          text: "No Pineapple threads yet. Use /new or send a message."
        };
      }

      const currentThreadId = await getCurrentTelegramThreadId(
        options.threadSelectionStore,
        options.threadStore,
        contextKey
      );

      return {
        text: createTelegramListText(threads, currentThreadId)
      };
    }
    case telegramCommandName.select: {
      const desiredThreadId = command.args.trim();

      if (!desiredThreadId) {
        return {
          text: "Usage: /select <thread-id-or-prefix>"
        };
      }

      const threads = await options.threadStore.listRecent(telegramSelectSearchLimit);
      const selectedThread = selectTelegramThread(threads, desiredThreadId);

      if (selectedThread === null) {
        return {
          text: "Thread not found. Use /list to see recent threads."
        };
      }

      await options.threadSelectionStore.setCurrent(contextKey, selectedThread.threadId);

      return {
        text: `Current Pineapple thread set to ${selectedThread.threadId}`
      };
    }
  }
}

async function resolveTelegramThreadId(
  update: TelegramAcceptedWebhookUpdate,
  options: TelegramUpdateProcessorOptions
): Promise<string> {
  const contextKey = getTelegramDeliveryContextKey(update.message);
  const currentThreadId = await getCurrentTelegramThreadId(
    options.threadSelectionStore,
    options.threadStore,
    contextKey
  );

  if (currentThreadId !== null) {
    await options.threadSelectionStore.setCurrent(contextKey, currentThreadId);
    trace("telegram", "thread resolved from selection", {
      updateId: update.updateId,
      threadId: currentThreadId
    });
    return currentThreadId;
  }

  const thread = await options.threadStore.create({});
  await options.threadSelectionStore.setCurrent(contextKey, thread.threadId);
  trace("telegram", "thread created for chat", {
    updateId: update.updateId,
    threadId: thread.threadId
  });

  return thread.threadId;
}

async function persistTelegramThreadContext(
  threadId: string,
  update: TelegramAcceptedWebhookUpdate,
  options: TelegramUpdateProcessorOptions
): Promise<void> {
  const thread = await options.threadStore.get(threadId);

  if (thread === null) {
    return;
  }

  const nextChatId = update.message.chatId;
  const nextChatType = update.message.chatType;
  const currentTelegramContext = thread.threadMetadata.deliveryContext.telegram;

  if (
    currentTelegramContext?.chatId === nextChatId &&
    currentTelegramContext.chatType === nextChatType
  ) {
    return;
  }

  const patchedThread = applyThreadMetadataPatch(thread, {
    threadMetadata: {
      deliveryContext: {
        ...thread.threadMetadata.deliveryContext,
        telegram: {
          chatId: nextChatId,
          chatType: nextChatType
        }
      }
    }
  });
  await options.threadStore.update(patchedThread);

  trace("telegram", "thread chat context persisted", {
    updateId: update.updateId,
    threadId,
    chatId: nextChatId,
    chatType: nextChatType
  });
}

async function getCurrentTelegramThreadId(
  threadSelectionStore: TelegramThreadSelectionStore,
  threadStore: ThreadStore,
  contextKey: string
): Promise<string | null> {
  const currentThreadId = await threadSelectionStore.getCurrent(contextKey);

  if (currentThreadId === null) {
    return null;
  }

  const thread = await threadStore.get(currentThreadId);

  return thread === null ? null : currentThreadId;
}

function createTelegramHelpText(): string {
  return [
    "Pineapple commands:",
    "/new [title] - start a new Pineapple thread",
    "/list - show recent threads in this chat",
    "/select <thread-id-or-prefix> - switch the current thread",
    "/current - show the current thread",
    "/help - show this help"
  ].join("\n");
}

function createTelegramListText(
  threads: Thread[],
  currentThreadId: string | null
): string {
  const lines = ["Recent Pineapple threads:"];

  for (const thread of threads) {
    const marker = thread.threadId === currentThreadId ? "*" : "-";
    lines.push(
      `${marker} ${shortTelegramThreadId(thread.threadId)}  ${thread.threadId}  ${thread.title ?? "Untitled"}`
    );

    if (thread.description !== null) {
      lines.push(`  ${thread.description}`);
    }
  }

  if (currentThreadId !== null) {
    lines.push("");
    lines.push(`Current: ${currentThreadId}`);
  }

  return lines.join("\n");
}

function selectTelegramThread(
  threads: Thread[],
  rawThreadId: string
): Thread | null {
  const needle = rawThreadId.trim().toLowerCase();

  if (!needle) {
    return null;
  }

  const matches = threads.filter((thread) =>
    thread.threadId.toLowerCase().startsWith(needle)
  );

  if (matches.length !== 1) {
    return null;
  }

  return matches[0] ?? null;
}

function shortTelegramThreadId(threadId: string): string {
  return threadId.slice(0, 8);
}
