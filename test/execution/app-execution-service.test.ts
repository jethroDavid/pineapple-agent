import { describe, expect, it } from "vitest";

import { AgentThreadNotFoundError } from "../../src/agents/errors.js";
import type { AppAgentRuntime } from "../../src/agents/agent-runtime.js";
import { PineappleDaemon } from "../../src/execution/queue/pineapple-daemon.js";
import { createAppExecutionService } from "../../src/execution/pipeline/service.js";
import { InMemoryThreadStore } from "../support/in-memory-thread-store.js";
import {
  InMemoryAgentExecutionDecisionStore,
  InMemoryAgentExecutionStore
} from "../support/in-memory-agent-execution-stores.js";

function createTestExecutionService(options: {
  agentRuntime: Pick<AppAgentRuntime, "getEntrypointAgentId" | "executeTurn">;
}) {
  const daemon = new PineappleDaemon(async () => undefined);
  daemon.start();
  const threadStore = new InMemoryThreadStore();
  const agentExecutionStore = new InMemoryAgentExecutionStore();
  const agentExecutionDecisionStore = new InMemoryAgentExecutionDecisionStore();

  return {
    daemon,
    threadStore,
    agentExecutionStore,
    agentExecutionDecisionStore,
    service: createAppExecutionService({
      daemon,
      agentRuntime: options.agentRuntime as AppAgentRuntime,
      threadStore,
      agentExecutionStore,
      agentExecutionDecisionStore
    })
  };
}

describe("createAppExecutionService", () => {
  it("returns AgentThreadNotFoundError for manual turns targeting a missing thread", async () => {
    const { service, daemon } = createTestExecutionService({
      agentRuntime: {
        getEntrypointAgentId: () => "root_manager",
        executeTurn: async () => {
          throw new Error("should not execute");
        }
      } as Pick<AppAgentRuntime, "getEntrypointAgentId" | "executeTurn">
    });

    await expect(
      service.runTurn({
        threadId: "725c9059-85d2-4759-a696-65e45de0d511",
        input: "continue"
      })
    ).rejects.toBeInstanceOf(AgentThreadNotFoundError);

    await daemon.stop();
  });

  it("records the active runtime agent on a pending approval after handoff", async () => {
    const { service, threadStore, agentExecutionDecisionStore, daemon } =
      createTestExecutionService({
        agentRuntime: {
          getEntrypointAgentId: () => "root_manager",
          executeTurn: async () => ({
            threadId: "ignored",
            rootAgentId: "root_manager",
            activeAgentId: "codex",
            activeAgentName: "Codex",
            finalOutput: "",
            lastResponseId: "resp-1",
            runState: "serialized-run-state",
            interruptions: [
              {
                name: "telegram_send_message",
                arguments: JSON.stringify({
                  chat_id: "5001"
                }),
                rawItem: {
                  callId: "call-1",
                  name: "telegram_send_message"
                }
              }
            ],
            newItems: [],
            outputItems: []
          })
        } as unknown as Pick<AppAgentRuntime, "getEntrypointAgentId" | "executeTurn">
      });

    const thread = await threadStore.create({});
    const result = await service.runTurn({
      threadId: thread.threadId,
      input: "Ask Codex to send a message"
    });

    expect(result.execution.status).toBe("awaiting_approval");
    expect(result.pendingDecision?.agentId).toBe("codex");

    const savedDecision = result.pendingDecision
      ? await agentExecutionDecisionStore.get(result.pendingDecision.decisionId)
      : null;
    expect(savedDecision?.agentId).toBe("codex");

    await daemon.stop();
  });
});
