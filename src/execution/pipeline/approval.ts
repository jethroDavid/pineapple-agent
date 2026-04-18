import {
  agentExecutionDecisionStatus,
  type AgentExecutionDecision
} from "../domain/agent-execution-decision.js";
import { agentExecutionStatus, type AgentExecution } from "../domain/agent-execution.js";
import {
  AgentExecutionDecisionNotFoundError,
  AgentExecutionNotAwaitingApprovalError
} from "../errors.js";
import type { ExecutionRequest, ExecutionTurnResult } from "../execution-contracts.js";
import type { AppExecutionServiceOptions } from "./context.js";
import type { Thread } from "../../threads/domain/thread.js";
import {
  getRawToolCallId,
  loadThread,
  parseToolArguments
} from "./shared.js";
import {
  cancelExecutionAfterTerminalDecision,
  markExecutionRunning
} from "./transitions.js";
import {
  buildApprovalResolution,
  executeWithRuntime,
  type PendingDecisionFactoryInput
} from "./runtime.js";

export interface DecisionResolutionRequestResult {
  decision: AgentExecutionDecision;
  result: ExecutionTurnResult;
}

export async function handleDecisionResolutionRequest(
  request: Extract<ExecutionRequest, { kind: "decision_resolution" }>,
  options: AppExecutionServiceOptions
): Promise<DecisionResolutionRequestResult> {
  const decision = await options.agentExecutionDecisionStore.get(request.decisionId);

  if (decision === null) {
    throw new AgentExecutionDecisionNotFoundError(request.decisionId);
  }

  const execution = await options.agentExecutionStore.get(decision.executionId);

  if (execution === null) {
    throw new Error(`Agent execution ${decision.executionId} was not found.`);
  }

  if (execution.status !== agentExecutionStatus.awaitingApproval) {
    throw new AgentExecutionNotAwaitingApprovalError(
      execution.executionId,
      execution.status
    );
  }

  const thread = await loadThread(execution.threadId, options.threadStore);
  const resolvedDecision = await options.agentExecutionDecisionStore.resolve(
    request.decisionId,
    request.resolution as never
  );

  if (resolvedDecision.status !== agentExecutionDecisionStatus.approved) {
    const canceledExecution = cancelExecutionAfterTerminalDecision(execution);
    await options.agentExecutionStore.update(canceledExecution);

    return {
      decision: resolvedDecision,
      result: {
        thread,
        execution: canceledExecution,
        route: null,
        finalOutput: null,
        lastResponseId: null,
        activeAgentId: canceledExecution.activeAgentId,
        activeAgentName: canceledExecution.activeAgentId,
        usedTools: [],
        pendingDecision: null
      }
    };
  }

  const result = await continueInterruptedExecution({
    execution,
    thread,
    decision: resolvedDecision,
    options
  });

  return {
    decision: resolvedDecision,
    result
  };
}

export async function continueInterruptedExecution(input: {
  execution: AgentExecution;
  thread: Thread;
  decision: AgentExecutionDecision | null;
  options: AppExecutionServiceOptions;
}): Promise<ExecutionTurnResult> {
  const started = markExecutionRunning(input.execution);
  await input.options.agentExecutionStore.update(started);

  return await executeWithRuntime({
    execution: started,
    thread: input.thread,
    route: null,
    runtimeOptions: {
      threadId: input.thread.threadId,
      serializedState: started.checkpoint.runState ?? undefined,
      approvalResolution: buildApprovalResolution(input.decision)
    },
    options: input.options,
    createPendingDecision
  });
}

export async function createPendingDecision(
  input: PendingDecisionFactoryInput
): Promise<AgentExecutionDecision> {
  const toolName = input.interruption.name;
  const toolCallId = getRawToolCallId(input.interruption.rawItem);

  if (!toolName || !toolCallId) {
    throw new Error("Tool approval interruption is missing tool identity.");
  }

  const toolArguments = parseToolArguments(input.interruption.arguments);

  return await input.options.agentExecutionDecisionStore.create({
    executionId: input.execution.executionId,
    threadId: input.thread.threadId,
    reasonCode: "approval_required",
    agentId: input.activeAgentId,
    toolName,
    toolCallId,
    toolArguments,
    requestedAction: {
      tool_name: toolName,
      tool_call_id: toolCallId,
      tool_arguments: toolArguments
    }
  });
}
