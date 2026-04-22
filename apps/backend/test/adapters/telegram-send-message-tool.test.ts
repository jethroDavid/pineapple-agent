import { describe, expect, it, vi } from "vitest";

import { TelegramBotClient } from "../../src/adapters/telegram/telegram-bot-client.js";
import { createTelegramSendMessageTool } from "../../src/adapters/telegram/telegram-send-message-tool.js";

describe("createTelegramSendMessageTool", () => {
  it("sends a Telegram message through the Bot API client", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue({
      ok: true,
      async json() {
        return {
      ok: true,
      result: {
        message_id: 11,
        date: 1_775_526_400,
        chat: {
              id: 5001,
              type: "private"
            }
          }
        };
      }
    });
    const client = new TelegramBotClient({
      botToken: "test-token",
      fetchImplementation: fetchImplementation as typeof fetch
    });
    const tool = createTelegramSendMessageTool({
      client
    });

    const result = await tool.execute({
      chat_id: "5001",
      text: "Hello from Pineapple"
    });

    expect(fetchImplementation).toHaveBeenCalledWith(
      "https://api.telegram.org/bottest-token/sendMessage",
      expect.objectContaining({
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          chat_id: "5001",
          text: "Hello from Pineapple"
        })
      })
    );
    expect(result).toEqual({
      ok: true,
      message_id: 11,
      chat_id: 5001,
      chat_type: "private",
      date: 1_775_526_400
    });
  });
});
