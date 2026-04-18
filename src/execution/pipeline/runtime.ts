import type { AgentExecuteTurnOptions, AppAgentRuntime } from "../../agents/agent-runtime.js";
import type { Thread } from "../../threads/domain/thread.js";
import type { TriggerRouteResult } from "../routing/route-trigger-event.js";
import {
  agentExecutionDecisionStatus,
  type AgentExecutionDecision
} from "../domain/agent-execution-decision.js";
import {
  agentExecutionStatus,
  type AgentExecution
} from "../domain/agent-execution.js";
import type { ExecutionTurnResult } from "../execution-contracts.js";
import type { AppExecutionServiceOptions } from "./context.js";
import {
  extractUsedTools,
  getErrorMessage,
  toRuntimeInput,
  updateCompletedThread
} from "./shared.js";
import {
  finishExecution,
  markExecutionRunning
} from "./transitions.js";

type RuntimeInterruption = NonNullable<
  Awaited<ReturnType<AppAgentRuntime["executeTurn"]>>["interruptions"]
>[number];

export interface PendingDecisionFactoryInput {
  execution: AgentExecution;
  thread: Thread;
  activeAgentId: string;
  interruption: RuntimeInterruption;
  options: AppExecutionServiceOptions;
}

export type PendingDecisionFactory = (
  input: PendingDecisionFactoryInput
) => Promise<AgentExecutionDecision>;

export async function runFreshExecution(input: {
  execution: AgentExecution;
  thread: Thread;
  route: TriggerRouteResult | null;
  options: AppExecutionServiceOptions;
  createPendingDecision: PendingDecisionFactory;
}): Promise<ExecutionTurnResult> {
  const started = markExecutionRunning(input.execution);
  await input.options.agentExecutionStore.update(started);

  return await executeWithRuntime({
    execution: started,
    thread: input.thread,
    route: input.route,
    runtimeOptions: {
      agentId: started.requestedAgentId ?? started.entrypointAgentId,
      threadId: input.thread.threadId,
      input: toRuntimeInput(started)
    },
    options: input.options,
    createPendingDecision: input.createPendingDecision
  });
}

export async function executeWithRuntime(input: {
  execution: AgentExecution;
  thread: Thread;
  route: TriggerRouteResult | null;
  runtimeOptions: AgentExecuteTurnOptions;
  options: AppExecutionServiceOptions;
  createPendingDecision: PendingDecisionFactory;
}): Promise<ExecutionTurnResult> {
  const runtime = input.options.agentRuntime;

  if (runtime === null || runtime === undefined) {
    throw new Error("Agent runtime is not configured. Set OPENAI_API_KEY and OPENAI_MODEL first.");
  }

  try {
    const runtimeResult = await runtime.executeTurn(input.runtimeOptions);
    const usedTools = extractUsedTools(runtimeResult.newItems);
    const interruption = runtimeResult.interruptions[0];
    const pendingDecision = interruption
      ? await input.createPendingDecision({
          execution: input.execution,
          thread: input.thread,
          activeAgentId: runtimeResult.activeAgentId,
          interruption,
          options: input.options
        })
      : null;

    const completedExecution =
      pendingDecision === null
        ? finishExecution(input.execution, {
            status: agentExecutionStatus.completed,
            activeAgentId: runtimeResult.activeAgentId,
            runState: null
          })
        : finishExecution(input.execution, {
            status: agentExecutionStatus.awaitingApproval,
            activeAgentId: runtimeResult.activeAgentId,
            runState: runtimeResult.runState
          });
    await input.options.agentExecutionStore.update(completedExecution);

    const nextThread =
      pendingDecision === null
        ? await updateCompletedThread(input.thread, runtimeResult.lastResponseId)
        : input.thread;

    if (pendingDecision === null) {
      await input.options.threadStore.update(nextThread);
    }

    return {
      thread: nextThread,
      execution: completedExecution,
      route: input.route,
      finalOutput: pendingDecision === null ? runtimeResult.finalOutput : null,
      lastResponseId: runtimeResult.lastResponseId,
      activeAgentId: runtimeResult.activeAgentId,
      activeAgentName: runtimeResult.activeAgentName,
      usedTools,
      pendingDecision
    };
  } catch (error) {
    const failedExecution = finishExecution(input.execution, {
      status: agentExecutionStatus.failed,
      errorCode: "execution_failed",
      errorMessage: getErrorMessage(error),
      runState: input.execution.checkpoint.runState
    });
    await input.options.agentExecutionStore.update(failedExecution);
    throw error;
  }
}

export function buildApprovalResolution(
  decision: AgentExecutionDecision | null
): AgentExecuteTurnOptions["approvalResolution"] {
  if (decision === null) {
    return undefined;
  }

  return {
    toolCallId: decision.toolCallId,
    toolName: decision.toolName,
    status: agentExecutionDecisionStatus.approved,
    message:
      decision.status === agentExecutionDecisionStatus.rejected
        ? `Tool ${decision.toolName} was rejected by a human reviewer.`
        : undefined
  };
}
