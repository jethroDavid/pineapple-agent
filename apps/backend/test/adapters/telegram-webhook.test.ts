import { describe, expect, it } from "vitest";

import {
  createTelegramTriggerEvent,
  getTelegramDeliveryContextKey,
  normalizeTelegramWebhookUpdate,
  telegramIgnoredReason
} from "../../src/adapters/telegram/telegram-webhook.js";

describe("normalizeTelegramWebhookUpdate", () => {
  it("normalizes a Telegram text message and keeps command-aware metadata", () => {
    const result = normalizeTelegramWebhookUpdate({
      update_id: 1001,
      message: {
        message_id: 55,
        message_thread_id: 7,
        date: 1_775_526_400,
        text: "Deploy status?",
        from: {
          id: 42,
          is_bot: false,
          username: "jethro",
          first_name: "Jethro"
        },
        chat: {
          id: -100123,
          type: "supergroup",
          title: "Ops"
        }
      }
    });

    expect(result.kind).toBe("accepted");

    if (result.kind !== "accepted") {
      throw new Error("Expected accepted result.");
    }

    expect(result).toMatchObject({
      updateId: 1001,
      eventType: "message",
      command: null,
      message: {
        actorId: "42",
        actorType: "human",
        chatId: "-100123",
        chatType: "supergroup",
        chatTitle: "Ops",
        messageThreadId: 7,
        senderLabel: "Jethro @jethro (42)",
        text: "Deploy status?",
        receivedAt: "2026-04-07T01:46:40.000Z"
      }
    });
    expect(getTelegramDeliveryContextKey(result.message)).toBe("-100123");
  });

  it("parses supported Telegram bot commands from new messages", () => {
    const result = normalizeTelegramWebhookUpdate({
      update_id: 1002,
      message: {
        message_id: 56,
        date: 1_775_526_460,
        text: "/select@pineapple_bot abc123",
        from: {
          id: 99,
          is_bot: false,
          first_name: "Ops"
        },
        chat: {
          id: 5001,
          type: "private"
        }
      }
    });

    expect(result.kind).toBe("accepted");

    if (result.kind !== "accepted") {
      throw new Error("Expected accepted result.");
    }

    expect(result.command).toEqual({
      name: "select",
      args: "abc123"
    });
  });

  it("creates a direct-thread TriggerEvent for a resolved Telegram thread", () => {
    const normalized = normalizeTelegramWebhookUpdate({
      update_id: 1003,
      edited_message: {
        message_id: 57,
        date: 1_775_526_520,
        caption: "Screenshot from production",
        from: {
          id: 99,
          is_bot: false,
          first_name: "Ops"
        },
        chat: {
          id: 5001,
          type: "private"
        }
      }
    });

    expect(normalized.kind).toBe("accepted");

    if (normalized.kind !== "accepted") {
      throw new Error("Expected accepted result.");
    }

    const triggerEvent = createTelegramTriggerEvent({
      update: normalized,
      threadId: "f84f61d3-465d-42aa-bf8f-9e3949713fb5"
    });

    expect(triggerEvent).toMatchObject({
      trigger_id: "telegram:update:1003",
      source: {
        kind: "webhook",
        system: "telegram",
        event_type: "edited_message"
      },
      actor: {
        type: "human",
        id: "99"
      },
      routing: {
        thread_id: "f84f61d3-465d-42aa-bf8f-9e3949713fb5",
        allow_unbound_thread: false
      },
      received_at: "2026-04-07T01:48:40.000Z"
    });
    expect(triggerEvent.payload).toEqual({
      input: [
        "Telegram update",
        "Event: edited_message",
        "Chat: private 5001",
        "Sender: Ops (99)",
        "",
        "Message:",
        "Screenshot from production"
      ].join("\n"),
      instructions:
        "This input came from Telegram. Reply like a natural chat message, not a formatted document. Use plain text only: no Markdown, headings, bullet lists, tables, bold or italic markers, or code fences unless the user explicitly asks for that format. Keep it concise and conversational, using short paragraphs only when they help readability. Return the reply text so Pineapple can deliver it to Telegram chat_id=5001."
    });
  });

  it("ignores unsupported update types", () => {
    const result = normalizeTelegramWebhookUpdate({
      update_id: 1004,
      callback_query: {
        id: "cb-1"
      }
    });

    expect(result).toEqual({
      kind: "ignored",
      updateId: 1004,
      eventType: "callback_query",
      reason: telegramIgnoredReason.unsupportedUpdateType
    });
  });
});
