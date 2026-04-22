import { afterEach, describe, expect, it } from "vitest";

import { AgentThreadNotFoundError } from "../../../src/agents/errors.js";
import { buildApp } from "../../../src/entrypoints/http/server.js";
import {
  createFakeAgentRuntime,
  createFakeExecutionService
} from "./support/app-fixtures.js";

describe("app agent runtime endpoint", () => {
  const apps: ReturnType<typeof buildApp>[] = [];

  afterEach(async () => {
    while (apps.length > 0) {
      const app = apps.pop();
      await app?.close();
    }
  });

  it("returns a thread-based response payload", async () => {
    const app = buildApp({
      agentRuntime: createFakeAgentRuntime(),
      execution: createFakeExecutionService()
    });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/agents/runs",
      payload: {
        input: "Inspect the repo"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      thread_id: "thread-1",
      execution_id: "execution-1",
      execution_status: "completed",
      root_agent_id: "root_manager",
      active_agent_id: "codex",
      active_agent_name: "Codex",
      final_output: "done",
      last_response_id: "resp-agent-1",
      pending_decision: null
    });
  });

  it("returns 404 when the requested agent thread does not exist", async () => {
    const app = buildApp({
      agentRuntime: createFakeAgentRuntime(),
      execution: createFakeExecutionService({
        agentError: new AgentThreadNotFoundError("thread-missing")
      })
    });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/agents/runs",
      payload: {
        thread_id: "8b990974-6e8d-4890-83d6-bb62ad5ff98e",
        input: "Continue"
      }
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: "Agent thread was not found.",
      message: "Thread thread-missing was not found."
    });
  });
});
