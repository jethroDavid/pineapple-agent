import OpenAI from "openai";
import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../../../src/entrypoints/http/server.js";
import {
  TriggerRoutingError,
  triggerRoutingErrorCode
} from "../../../src/execution/routing/route-trigger-event.js";
import {
  createDrizzleQueryError,
  createFakeExecutionService,
  validTriggerPayload
} from "./support/app-fixtures.js";

describe("app trigger endpoint", () => {
  const apps: ReturnType<typeof buildApp>[] = [];

  afterEach(async () => {
    while (apps.length > 0) {
      const app = apps.pop();
      await app?.close();
    }
  });

  it("returns 400 for invalid trigger payloads", async () => {
    const app = buildApp({
      execution: createFakeExecutionService()
    });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/triggers",
      payload: {
        version: 1,
        trigger_id: "cli:test-trigger-1",
        source: {
          kind: "cli",
          system: "pineapple-cli",
          event_type: "command.invoked"
        },
        actor: {
          type: "human",
          id: "jethro"
        },
        routing: {},
        payload: {
          input: "Hello"
        },
        received_at: "2026-04-04T12:00:00.000Z"
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: "Invalid request payload."
    });
  });

  it("returns 404 when direct thread routing targets a missing thread", async () => {
    const app = buildApp({
      execution: createFakeExecutionService({
        triggerError: new TriggerRoutingError(
          triggerRoutingErrorCode.threadNotFound,
          "Thread 123 was not found."
        )
      })
    });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/triggers",
      payload: validTriggerPayload()
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: "Routing failed.",
      code: "thread_not_found",
      message: "Thread 123 was not found."
    });
  });

  it("returns 409 when trigger_id violates the run idempotency constraint", async () => {
    const app = buildApp({
      execution: createFakeExecutionService({
        triggerError: createDrizzleQueryError({
          code: "23505",
          constraint: "agent_executions_trigger_id_unique_idx",
          message:
            'duplicate key value violates unique constraint "agent_executions_trigger_id_unique_idx"'
        })
      })
    });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/triggers",
      payload: validTriggerPayload()
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: "Duplicate trigger_id.",
      message: "This TriggerEvent was already accepted before."
    });
  });

  it("returns 409 when the thread already has an active run", async () => {
    const app = buildApp({
      execution: createFakeExecutionService({
        triggerError: createDrizzleQueryError({
          code: "23505",
          constraint: "agent_executions_active_thread_unique_idx",
          message:
            'duplicate key value violates unique constraint "agent_executions_active_thread_unique_idx"'
        })
      })
    });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/triggers",
      payload: validTriggerPayload()
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: "Thread already has an active execution.",
      message: "Wait for the existing execution to complete before submitting another one."
    });
  });

  it("returns 503 when OpenAI is temporarily unavailable", async () => {
    const app = buildApp({
      execution: createFakeExecutionService({
        triggerError: new OpenAI.RateLimitError(
          429,
          { error: { message: "rate limited" } },
          "rate limited",
          new Headers()
        )
      })
    });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/triggers",
      payload: validTriggerPayload()
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: "OpenAI is temporarily unavailable.",
      message: "rate limited"
    });
  });
});
