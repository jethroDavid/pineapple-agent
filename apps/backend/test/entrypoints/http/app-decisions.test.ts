import { afterEach, describe, expect, it } from "vitest";

import { buildApp } from "../../../src/entrypoints/http/server.js";
import {
  agentExecutionDecisionStatus
} from "../../../src/execution/domain/agent-execution-decision.js";
import { createFakeExecutionService } from "./support/app-fixtures.js";

describe("app decision resolution endpoint", () => {
  const apps: ReturnType<typeof buildApp>[] = [];

  afterEach(async () => {
    while (apps.length > 0) {
      const app = apps.pop();
      await app?.close();
    }
  });

  it("returns the next pending decision when approval resolution pauses again", async () => {
    const app = buildApp({
      execution: createFakeExecutionService({
        decisionResult: {
          decision: {
            decisionId: "decision-1",
            status: agentExecutionDecisionStatus.approved
          },
          result: {
            thread: {
              threadId: "thread-1"
            },
            execution: {
              executionId: "execution-1",
              status: "awaiting_approval"
            },
            route: null,
            finalOutput: "",
            replyText: "",
            lastResponseId: "resp-2",
            activeAgentId: "root_manager",
            activeAgentName: "Root Manager",
            usedTools: [],
            pendingDecision: {
              decisionId: "decision-2",
              executionId: "execution-1",
              threadId: "thread-1",
              status: agentExecutionDecisionStatus.pending,
              reasonCode: "approval_required",
              toolName: "store_text_note",
              toolCallId: "call-2",
              agentId: "root_manager",
              toolArguments: {},
              requestedAction: {
                tool_name: "store_text_note"
              },
              expiresAt: null,
              resolvedByActor: null,
              resolvedAt: null,
              createdAt: new Date("2026-04-05T10:00:00.000Z")
            }
          }
        }
      })
    });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/decisions/decision-1/resolve",
      payload: {
        status: "approved",
        resolved_by_actor: "jethro"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      decision_id: "decision-1",
      decision_status: "approved",
      execution_id: "execution-1",
      execution_status: "awaiting_approval",
      thread_id: "thread-1",
      active_agent_id: "root_manager",
      active_agent_name: "Root Manager",
      output_text: "",
      pending_decision: {
        decision_id: "decision-2",
        status: "pending",
        reason_code: "approval_required",
        requested_action: {
          tool_name: "store_text_note"
        },
        expires_at: null,
        created_at: "2026-04-05T10:00:00.000Z"
      }
    });
  });
});
