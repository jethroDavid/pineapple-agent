import { z } from "zod";

import type { ToolDefinition } from "../../tools/tool-definition.js";
import type { TelegramBotClientLike } from "./telegram-bot-client.js";

type TelegramSendMessageInput = {
  chat_id: string;
  text: string;
};

const telegramSendMessageInputSchema: z.ZodType<TelegramSendMessageInput> = z.object({
  chat_id: z.string().min(1),
  text: z.string().min(1)
});

const telegramSendMessageOutputSchema = z.object({
  ok: z.literal(true),
  message_id: z.number().int(),
  chat_id: z.number().int(),
  chat_type: z.string().min(1),
  date: z.number().int()
});

type TelegramSendMessageOutput = z.infer<typeof telegramSendMessageOutputSchema>;

export function createTelegramSendMessageTool(options: {
  client: TelegramBotClientLike;
}): ToolDefinition<TelegramSendMessageInput, TelegramSendMessageOutput> {
  const { client } = options;

  return {
    name: "telegram_send_message",
    description: "Send a plain-text Telegram message to an existing chat using chat_id.",
    inputSchema: telegramSendMessageInputSchema,
    outputSchema: telegramSendMessageOutputSchema,
    sideEffecting: true,
    approvalRequired: false,
    idempotent: false,
    async execute(input): Promise<TelegramSendMessageOutput> {
      const result = await client.sendMessage({
        chat_id: input.chat_id,
        text: input.text
      });

      return {
        ok: true,
        message_id: result.message_id,
        chat_id: result.chat.id,
        chat_type: result.chat.type,
        date: result.date
      };
    }
  };
}
