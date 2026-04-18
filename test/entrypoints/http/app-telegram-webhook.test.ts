import { afterEach, describe, expect, it } from "vitest";

import { createTelegramAdapter } from "../../../src/adapters/telegram/telegram-adapter.js";
import type { TriggerEvent } from "../../../src/execution/contracts/trigger-event.js";
import { buildApp } from "../../../src/entrypoints/http/server.js";
import { InMemoryThreadStore } from "../../support/in-memory-thread-store.js";
import {
  createFakeExecutionService,
  createFakeTelegramBotClient,
  InMemoryTelegramThreadSelectionStore,
  validTelegramUpdatePayload
} from "./support/app-fixtures.js";

describe("app Telegram webhook endpoint", () => {
  const apps: ReturnType<typeof buildApp>[] = [];

  afterEach(async () => {
    while (apps.length > 0) {
      const app = apps.pop();
      await app?.close();
    }
  });

  it("returns 401 when the Telegram webhook secret header does not match", async () => {
    const threadStore = new InMemoryThreadStore();
    const threadSelectionStore = new InMemoryTelegramThreadSelectionStore();
    const app = buildApp({
      adapters: [
        createTelegramAdapter({
          botToken: "bot-token",
          client: createFakeTelegramBotClient(),
          inboundMode: "webhook",
          webhookBaseUrl: "https://pineapple.example.ts.net",
          webhookSecret: "telegram-secret",
          threadStore,
          threadSelectionStore
        })!
      ],
      execution: createFakeExecutionService()
    });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/adapters/telegram/webhook",
      headers: {
        "x-telegram-bot-api-secret-token": "wrong-secret"
      },
      payload: validTelegramUpdatePayload()
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: "Invalid Telegram webhook secret."
    });
  });

  it("enqueues a normalized TriggerEvent for Telegram text messages", async () => {
    const enqueuedTriggers: TriggerEvent[] = [];
    const threadStore = new InMemoryThreadStore();
    const threadSelectionStore = new InMemoryTelegramThreadSelectionStore();
    const app = buildApp({
      adapters: [
        createTelegramAdapter({
          botToken: "bot-token",
          client: createFakeTelegramBotClient(),
          inboundMode: "webhook",
          webhookBaseUrl: "https://pineapple.example.ts.net",
          webhookSecret: "telegram-secret",
          threadStore,
          threadSelectionStore
        })!
      ],
      execution: createFakeExecutionService({
        enqueuedTriggers
      })
    });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/adapters/telegram/webhook",
      headers: {
        "x-telegram-bot-api-secret-token": "telegram-secret"
      },
      payload: validTelegramUpdatePayload()
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(enqueuedTriggers).toHaveLength(1);
    expect(enqueuedTriggers[0]).toMatchObject({
      trigger_id: "telegram:update:1001",
      source: {
        kind: "webhook",
        system: "telegram",
        event_type: "message"
      },
      actor: {
        type: "human",
        id: "42"
      },
      routing: {
        thread_id: expect.any(String)
      }
    });
    expect(enqueuedTriggers[0]?.payload).toMatchObject({
      input: expect.stringContaining("Hello from Telegram")
    });
    expect(threadStore.list()).toHaveLength(1);
  });

  it("acknowledges but ignores unsupported Telegram updates", async () => {
    const enqueuedTriggers: TriggerEvent[] = [];
    const threadStore = new InMemoryThreadStore();
    const threadSelectionStore = new InMemoryTelegramThreadSelectionStore();
    const app = buildApp({
      adapters: [
        createTelegramAdapter({
          botToken: "bot-token",
          client: createFakeTelegramBotClient(),
          inboundMode: "webhook",
          webhookBaseUrl: "https://pineapple.example.ts.net",
          webhookSecret: "telegram-secret",
          threadStore,
          threadSelectionStore
        })!
      ],
      execution: createFakeExecutionService({
        enqueuedTriggers
      })
    });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/adapters/telegram/webhook",
      headers: {
        "x-telegram-bot-api-secret-token": "telegram-secret"
      },
      payload: {
        update_id: 1002,
        callback_query: {
          id: "cb-1"
        }
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(enqueuedTriggers).toHaveLength(0);
  });
});
