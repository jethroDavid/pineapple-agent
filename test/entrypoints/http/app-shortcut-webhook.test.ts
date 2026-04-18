import { afterEach, describe, expect, it } from "vitest";

import { createShortcutAdapter } from "../../../src/adapters/shortcut/shortcut-adapter.js";
import type { TriggerEvent } from "../../../src/execution/contracts/trigger-event.js";
import { buildApp } from "../../../src/entrypoints/http/server.js";
import {
  createFakeExecutionService,
  createFakeShortcutClient,
  createShortcutSignature,
  validShortcutWebhookPayload
} from "./support/app-fixtures.js";

describe("app Shortcut webhook endpoint", () => {
  const apps: ReturnType<typeof buildApp>[] = [];

  afterEach(async () => {
    while (apps.length > 0) {
      const app = apps.pop();
      await app?.close();
    }
  });

  it("returns 401 when the Shortcut webhook signature does not match", async () => {
    const payload = JSON.stringify(validShortcutWebhookPayload());
    const app = buildApp({
      adapters: [
        createShortcutAdapter({
          apiToken: "shortcut-token",
          webhookSecret: "shortcut-secret",
          webhookBaseUrl: "https://pineapple.example.ts.net",
          webhookIntegrationId: "500107362",
          agentName: "pineapple",
          client: createFakeShortcutClient()
        })!
      ],
      execution: createFakeExecutionService()
    });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/adapters/shortcut/webhook",
      headers: {
        "content-type": "application/json",
        "payload-signature": "wrong-signature"
      },
      payload
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      error: "Invalid Shortcut webhook signature."
    });
  });

  it("enqueues a normalized TriggerEvent for Shortcut comment deliveries", async () => {
    const enqueuedTriggers: TriggerEvent[] = [];
    const payload = JSON.stringify(validShortcutWebhookPayload());
    const app = buildApp({
      adapters: [
        createShortcutAdapter({
          apiToken: "shortcut-token",
          webhookSecret: "shortcut-secret",
          webhookBaseUrl: "https://pineapple.example.ts.net",
          webhookIntegrationId: "500107362",
          agentName: "pineapple",
          client: createFakeShortcutClient()
        })!
      ],
      execution: createFakeExecutionService({
        enqueuedTriggers
      })
    });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/adapters/shortcut/webhook",
      headers: {
        "content-type": "application/json",
        "payload-signature": createShortcutSignature(payload, "shortcut-secret")
      },
      payload
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(enqueuedTriggers).toHaveLength(1);
    expect(enqueuedTriggers[0]).toMatchObject({
      trigger_id: "shortcut:webhook:9001",
      source: {
        kind: "webhook",
        system: "shortcut",
        event_type: "comment.created"
      },
      routing: {
        subject_type: "shortcut_story",
        subject_id: "123"
      }
    });
    expect(enqueuedTriggers[0]?.payload).toMatchObject({
      input: expect.stringContaining("Add memory to the agent"),
      instructions: expect.stringContaining("shortcut_update_story")
    });
  });
});
