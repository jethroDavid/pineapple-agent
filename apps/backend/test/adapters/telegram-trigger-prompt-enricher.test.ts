import { describe, expect, it } from "vitest";

import { telegramReminderTriggerPromptEnricher } from "../../src/adapters/telegram/telegram-trigger-prompt-enricher.js";
import {
  createTriggerEvent,
  triggerActorType,
  triggerSourceKind
} from "../../src/execution/contracts/trigger-event.js";
import { createThread } from "../../src/threads/domain/thread.js";

describe("telegramReminderTriggerPromptEnricher", () => {
  it("adds Telegram delivery instructions for cron reminders", () => {
    const thread = createThread({
      threadMetadata: {
        deliveryContext: {
          telegram: {
            chatId: "5001",
            chatType: "private"
          }
        }
      }
    });
    const prompt = telegramReminderTriggerPromptEnricher({
      triggerEvent: createTriggerEvent({
        trigger_id: "cron:reminder:1",
        source: {
          kind: triggerSourceKind.system,
          system: "pineapple-cron",
          event_type: "reminder.tick"
        },
        actor: {
          type: triggerActorType.system,
          id: "pineapple-cron"
        },
        routing: {
          thread_id: thread.threadId
        },
        payload: {
          input: "Reminder",
          instructions: "Base instruction."
        }
      }),
      thread,
      prompt: {
        input: "Reminder",
        instructions: "Base instruction."
      }
    });

    expect(prompt.instructions).toContain("Base instruction.");
    expect(prompt.instructions).toContain(
      "Delivery context: this reminder belongs to Telegram chat_id=5001 (chat_type=private)."
    );
    expect(prompt.instructions).toContain(
      "Call telegram_send_message using this exact chat_id."
    );
  });

  it("leaves non-reminder prompts unchanged", () => {
    const thread = createThread({});
    const prompt = {
      input: "Hello",
      instructions: "Keep this."
    };

    expect(
      telegramReminderTriggerPromptEnricher({
        triggerEvent: createTriggerEvent({
          trigger_id: "telegram:update:1",
          source: {
            kind: triggerSourceKind.webhook,
            system: "telegram",
            event_type: "message"
          },
          actor: {
            type: triggerActorType.human,
            id: "42"
          },
          routing: {
            thread_id: thread.threadId
          },
          payload: {
            input: "Hello"
          }
        }),
        thread,
        prompt
      })
    ).toBe(prompt);
  });
});
