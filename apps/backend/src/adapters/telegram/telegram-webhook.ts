import { z } from "zod";

import {
  createTriggerEvent,
  triggerActorType,
  triggerSourceKind,
  type TriggerEvent
} from "../../execution/contracts/trigger-event.js";

export const telegramWebhookSecretHeader = "x-telegram-bot-api-secret-token";

export const telegramIgnoredReason = {
  unsupportedMessageContent: "unsupported_message_content",
  unsupportedUpdateType: "unsupported_update_type"
} as const;

type TelegramIgnoredReason =
  (typeof telegramIgnoredReason)[keyof typeof telegramIgnoredReason];

export const telegramCommandName = {
  agent: "agent",
  agents: "agents",
  current: "current",
  help: "help",
  list: "list",
  new: "new",
  select: "select"
} as const;

type TelegramCommandName =
  (typeof telegramCommandName)[keyof typeof telegramCommandName];

interface TelegramCommand {
  name: TelegramCommandName;
  args: string;
}

export interface TelegramAcceptedWebhookUpdate {
  kind: "accepted";
  updateId: number;
  eventType: "message" | "edited_message";
  command: TelegramCommand | null;
  message: TelegramInboundMessageContext;
}

interface TelegramInboundMessageContext {
  actorId: string;
  actorType: string;
  chatId: string;
  chatType: string;
  chatTitle: string | null;
  chatUsername: string | null;
  messageId: number;
  messageThreadId: number | null;
  replyToMessageId: number | null;
  senderLabel: string;
  text: string;
  receivedAt: string;
}

interface IgnoredTelegramWebhookUpdate {
  kind: "ignored";
  updateId: number;
  eventType: string;
  reason: TelegramIgnoredReason;
}

type TelegramWebhookUpdateResult =
  | TelegramAcceptedWebhookUpdate
  | IgnoredTelegramWebhookUpdate;

const telegramUserSchema = z
  .object({
    id: z.number().int(),
    is_bot: z.boolean(),
    username: z.string().min(1).optional(),
    first_name: z.string().min(1).optional(),
    last_name: z.string().min(1).optional()
  })
  .loose();

const telegramChatSchema = z
  .object({
    id: z.number().int(),
    type: z.string().min(1),
    title: z.string().min(1).optional(),
    username: z.string().min(1).optional()
  })
  .loose();

const telegramMessageSchema = z
  .object({
    message_id: z.number().int(),
    message_thread_id: z.number().int().optional(),
    date: z.number().int().nonnegative(),
    text: z.string().min(1).optional(),
    caption: z.string().min(1).optional(),
    from: telegramUserSchema.optional(),
    chat: telegramChatSchema,
    reply_to_message: z
      .object({
        message_id: z.number().int()
      })
      .loose()
      .optional()
  })
  .loose();

const telegramUpdateSchema = z
  .object({
    update_id: z.number().int().nonnegative(),
    message: telegramMessageSchema.optional(),
    edited_message: telegramMessageSchema.optional()
  })
  .loose();

type TelegramMessage = z.infer<typeof telegramMessageSchema>;
type TelegramUpdate = z.infer<typeof telegramUpdateSchema>;

const supportedTelegramCommands = new Set<TelegramCommandName>(
  Object.values(telegramCommandName)
);

export function normalizeTelegramWebhookUpdate(
  input: unknown
): TelegramWebhookUpdateResult {
  const update = telegramUpdateSchema.parse(input);

  if (update.message !== undefined) {
    return normalizeMessageUpdate(update, "message", update.message);
  }

  if (update.edited_message !== undefined) {
    return normalizeMessageUpdate(update, "edited_message", update.edited_message);
  }

  return {
    kind: "ignored",
    updateId: update.update_id,
    eventType: detectUpdateEventType(update),
    reason: telegramIgnoredReason.unsupportedUpdateType
  };
}

export function createTelegramTriggerEvent(options: {
  update: TelegramAcceptedWebhookUpdate;
  threadId: string;
  agentId?: string | null;
}): TriggerEvent {
  const { update, threadId } = options;

  return createTriggerEvent({
    trigger_id: `telegram:update:${update.updateId}`,
    source: {
      kind: triggerSourceKind.webhook,
      system: "telegram",
      event_type: update.eventType
    },
    actor: {
      type: update.message.actorType as TriggerEvent["actor"]["type"],
      id: update.message.actorId
    },
    routing: {
      thread_id: threadId
    },
    payload: {
      input: createTelegramPromptInput(update.eventType, update.message),
      instructions: createTelegramInstructions(update.message),
      ...(options.agentId ? { agent_id: options.agentId } : {})
    },
    received_at: update.message.receivedAt
  });
}

export function getTelegramDeliveryContextKey(message: TelegramInboundMessageContext): string {
  return message.chatId;
}

function normalizeMessageUpdate(
  update: TelegramUpdate,
  eventType: "message" | "edited_message",
  message: TelegramMessage
): TelegramWebhookUpdateResult {
  const messageText = message.text ?? message.caption;

  if (!messageText) {
    return {
      kind: "ignored",
      updateId: update.update_id,
      eventType,
      reason: telegramIgnoredReason.unsupportedMessageContent
    };
  }

  const context: TelegramInboundMessageContext = {
    actorId: getActorId(message),
    actorType: getActorType(message),
    chatId: String(message.chat.id),
    chatType: message.chat.type,
    chatTitle: message.chat.title ?? null,
    chatUsername: message.chat.username ?? null,
    messageId: message.message_id,
    messageThreadId: message.message_thread_id ?? null,
    replyToMessageId: message.reply_to_message?.message_id ?? null,
    senderLabel: getSenderLabel(message),
    text: messageText,
    receivedAt: new Date(message.date * 1000).toISOString()
  };

  return {
    kind: "accepted",
    updateId: update.update_id,
    eventType,
    command: eventType === "message" ? parseTelegramCommand(message.text) : null,
    message: context
  };
}

function getActorType(message: TelegramMessage): string {
  if (!message.from) {
    return triggerActorType.unknown;
  }

  return message.from.is_bot ? triggerActorType.agent : triggerActorType.human;
}

function getActorId(message: TelegramMessage): string {
  if (message.from) {
    return String(message.from.id);
  }

  return `chat:${message.chat.id}`;
}

function createTelegramPromptInput(
  eventType: string,
  message: TelegramInboundMessageContext
): string {
  const lines = [
    "Telegram update",
    `Event: ${eventType}`,
    `Chat: ${message.chatType} ${message.chatId}${getChatLabelSuffix(message)}`,
    `Sender: ${message.senderLabel}`,
    message.replyToMessageId !== null
      ? `Reply to message id: ${message.replyToMessageId}`
      : null,
    "",
    "Message:",
    message.text
  ];

  return lines.filter((line): line is string => line !== null).join("\n");
}

function createTelegramInstructions(message: TelegramInboundMessageContext): string {
  const lines = [
    "This input came from Telegram.",
    "Reply like a natural chat message, not a formatted document.",
    "Use plain text only: no Markdown, headings, bullet lists, tables, bold or italic markers, or code fences unless the user explicitly asks for that format.",
    "Keep it concise and conversational, using short paragraphs only when they help readability.",
    `Return the reply text so Pineapple can deliver it to Telegram chat_id=${message.chatId}.`
  ];

  return lines.join(" ");
}

function getChatLabelSuffix(message: TelegramInboundMessageContext): string {
  if (message.chatTitle) {
    return ` (${message.chatTitle})`;
  }

  if (message.chatUsername) {
    return ` (@${message.chatUsername})`;
  }

  return "";
}

function getSenderLabel(message: TelegramMessage): string {
  if (!message.from) {
    return "unknown";
  }

  const name = [message.from.first_name, message.from.last_name]
    .filter((value): value is string => value !== undefined)
    .join(" ")
    .trim();
  const username = message.from.username ? ` @${message.from.username}` : "";

  if (name) {
    return `${name}${username} (${message.from.id})`;
  }

  if (message.from.username) {
    return `@${message.from.username} (${message.from.id})`;
  }

  return String(message.from.id);
}

function parseTelegramCommand(text: string | undefined): TelegramCommand | null {
  if (!text) {
    return null;
  }

  const trimmed = text.trim();

  if (!trimmed.startsWith("/")) {
    return null;
  }

  const [commandToken, ...rest] = trimmed.split(/\s+/);
  const match = /^\/([A-Za-z0-9_]+)(?:@[A-Za-z0-9_]+)?$/.exec(commandToken);

  if (!match) {
    return null;
  }

  const name = match[1]!.toLowerCase();

  if (!supportedTelegramCommands.has(name as TelegramCommandName)) {
    return null;
  }

  return {
    name: name as TelegramCommandName,
    args: rest.join(" ").trim()
  };
}

function detectUpdateEventType(update: TelegramUpdate): string {
  const updateRecord = update as Record<string, unknown>;

  for (const key of Object.keys(updateRecord)) {
    if (key === "update_id") {
      continue;
    }

    if (updateRecord[key] !== undefined) {
      return key;
    }
  }

  return "unknown";
}
