import { describe, expect, it, vi } from "vitest";

import type { AppAgentRuntime } from "../../src/agents/agent-runtime.js";
import { PineappleDaemon } from "../../src/execution/queue/pineapple-daemon.js";
import type { AppExecutionServiceOptions } from "../../src/execution/pipeline/context.js";
import { handleDecisionResolutionRequest } from "../../src/execution/pipeline/approval.js";
import { submitExecutionRequest } from "../../src/execution/pipeline/dispatch.js";
import { handleRecoveryRequest } from "../../src/execution/pipeline/recovery.js";
import {
  agentExecutionKind,
  agentExecutionStatus
} from "../../src/execution/domain/agent-execution.js";
import { InMemoryThreadStore } from "../support/in-memory-thread-store.js";
import {
  InMemoryAgentExecutionDecisionStore,
  InMemoryAgentExecutionStore
} from "../support/in-memory-agent-execution-stores.js";

function createRuntimeResult(
  overrides: Partial<Awaited<ReturnType<AppAgentRuntime["executeTurn"]>>> = {}
): Awaited<ReturnType<AppAgentRuntime["executeTurn"]>> {
  return {
    threadId: "ignored",
    rootAgentId: "root_manager",
    activeAgentId: "root_manager",
    activeAgentName: "Root Manager",
    finalOutput: "done",
    lastResponseId: "resp-1",
    runState: "runtime-state",
    interruptions: [],
    newItems: [],
    outputItems: [],
    ...overrides
  };
}

function createExecutionContext(options?: {
  executeTurn?: AppAgentRuntime["executeTurn"];
  entrypointAgentId?: string;
}): {
  daemon: PineappleDaemon<unknown>;
  threadStore: InMemoryThreadStore;
  agentExecutionStore: InMemoryAgentExecutionStore;
  agentExecutionDecisionStore: InMemoryAgentExecutionDecisionStore;
  executeTurn: ReturnType<typeof vi.fn<AppAgentRuntime["executeTurn"]>>;
  serviceOptions: AppExecutionServiceOptions;
} {
  const daemon = new PineappleDaemon(async () => undefined);
  daemon.start();

  const executeTurn = vi.fn<AppAgentRuntime["executeTurn"]>(
    options?.executeTurn ??
      (async () => createRuntimeResult())
  );

  const agentRuntime = {
    getEntrypointAgentId: () => options?.entrypointAgentId ?? "root_manager",
    executeTurn
  } as unknown as AppAgentRuntime;

  const threadStore = new InMemoryThreadStore();
  const agentExecutionStore = new InMemoryAgentExecutionStore();
  const agentExecutionDecisionStore = new InMemoryAgentExecutionDecisionStore();

  return {
    daemon,
    threadStore,
    agentExecutionStore,
    agentExecutionDecisionStore,
    executeTurn,
    serviceOptions: {
      daemon,
      agentRuntime,
      threadStore,
      agentExecutionStore,
      agentExecutionDecisionStore
    }
  };
}

describe("app execution modules", () => {
  it("dispatches manual turns through the request dispatcher", async () => {
    const context = createExecutionContext();
    const thread = await context.threadStore.create({});

    const result = await submitExecutionRequest({
      request: {
        kind: "manual_turn",
        threadId: thread.threadId,
        input: "continue"
      },
      options: context.serviceOptions
    });

    expect(result.execution.kind).toBe(agentExecutionKind.manualTurn);
    expect(result.execution.status).toBe(agentExecutionStatus.completed);
    expect(result.pendingDecision).toBeNull();
    expect(context.executeTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: thread.threadId
      })
    );

    await context.daemon.stop();
  });

  it("resolves approval decisions and continues interrupted execution", async () => {
    const context = createExecutionContext({
      executeTurn: async (runtimeOptions) => {
        expect(runtimeOptions.serializedState).toBe("checkpoint-state");
        expect(runtimeOptions.approvalResolution?.status).toBe("approved");

        return createRuntimeResult({
          runState: "resumed-state",
          finalOutput: "approved and continued"
        });
      }
    });
    const thread = await context.threadStore.create({});
    const execution = await context.agentExecutionStore.create({
      threadId: thread.threadId,
      kind: agentExecutionKind.manualTurn,
      entrypointAgentId: "root_manager",
      requestedAgentId: "root_manager",
      activeAgentId: "root_manager",
      checkpoint: {
        inputItems: [{ role: "user", content: "run" }],
        routeKind: null,
        runState: "checkpoint-state"
      }
    });

    await context.agentExecutionStore.update({
      ...execution,
      status: agentExecutionStatus.awaitingApproval,
      checkpoint: {
        ...execution.checkpoint,
        runState: "checkpoint-state"
      }
    });

    const decision = await context.agentExecutionDecisionStore.create({
      executionId: execution.executionId,
      threadId: thread.threadId,
      reasonCode: "approval_required",
      agentId: "root_manager",
      toolName: "telegram_send_message",
      toolCallId: "call-1",
      toolArguments: {},
      requestedAction: {}
    });

    const result = await handleDecisionResolutionRequest(
      {
        kind: "decision_resolution",
        decisionId: decision.decisionId,
        resolution: {
          status: "approved",
          resolvedByActor: "human"
        }
      },
      context.serviceOptions
    );

    expect(result.decision.status).toBe("approved");
    expect(result.result.execution.status).toBe(agentExecutionStatus.completed);
    expect(result.result.pendingDecision).toBeNull();

    await context.daemon.stop();
  });

  it("recovers awaiting-approval executions without re-running the runtime", async () => {
    const context = createExecutionContext();
    const thread = await context.threadStore.create({});
    const execution = await context.agentExecutionStore.create({
      threadId: thread.threadId,
      kind: agentExecutionKind.manualTurn,
      entrypointAgentId: "root_manager",
      requestedAgentId: "root_manager",
      activeAgentId: "codex",
      checkpoint: {
        inputItems: [{ role: "user", content: "run" }],
        routeKind: null,
        runState: "checkpoint-state"
      }
    });

    await context.agentExecutionStore.update({
      ...execution,
      status: agentExecutionStatus.awaitingApproval
    });

    const pendingDecision = await context.agentExecutionDecisionStore.create({
      executionId: execution.executionId,
      threadId: thread.threadId,
      reasonCode: "approval_required",
      agentId: "codex",
      toolName: "telegram_send_message",
      toolCallId: "call-1",
      toolArguments: {},
      requestedAction: {}
    });

    const recovered = await handleRecoveryRequest(
      execution.executionId,
      context.serviceOptions
    );

    expect(recovered.execution.status).toBe(agentExecutionStatus.awaitingApproval);
    expect(recovered.pendingDecision?.decisionId).toBe(pendingDecision.decisionId);
    expect(context.executeTurn).not.toHaveBeenCalled();

    await context.daemon.stop();
  });

  it("continues interrupted executions during recovery when runState exists", async () => {
    const context = createExecutionContext({
      executeTurn: async (runtimeOptions) => {
        expect(runtimeOptions.serializedState).toBe("checkpoint-state");
        expect(runtimeOptions.approvalResolution).toBeUndefined();

        return createRuntimeResult({
          finalOutput: "recovered"
        });
      }
    });
    const thread = await context.threadStore.create({});
    const execution = await context.agentExecutionStore.create({
      threadId: thread.threadId,
      kind: agentExecutionKind.manualTurn,
      entrypointAgentId: "root_manager",
      requestedAgentId: "root_manager",
      activeAgentId: "root_manager",
      checkpoint: {
        inputItems: [{ role: "user", content: "run" }],
        routeKind: null,
        runState: "checkpoint-state"
      }
    });

    await context.agentExecutionStore.update({
      ...execution,
      status: agentExecutionStatus.running,
      checkpoint: {
        ...execution.checkpoint,
        runState: "checkpoint-state"
      }
    });

    const recovered = await handleRecoveryRequest(
      execution.executionId,
      context.serviceOptions
    );

    expect(recovered.execution.status).toBe(agentExecutionStatus.completed);
    expect(recovered.finalOutput).toBe("recovered");
    expect(context.executeTurn).toHaveBeenCalledTimes(1);

    await context.daemon.stop();
  });
});
