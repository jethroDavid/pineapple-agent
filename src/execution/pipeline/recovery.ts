import { agentExecutionStatus } from "../domain/agent-execution.js";
import type { ExecutionTurnResult } from "../execution-contracts.js";
import type { AppExecutionServiceOptions } from "./context.js";
import type { TriggerRouteResult } from "../routing/route-trigger-event.js";
import {
  continueInterruptedExecution,
  createPendingDecision
} from "./approval.js";
import { runFreshExecution } from "./runtime.js";
import { loadThread } from "./shared.js";

export async function handleRecoveryRequest(
  executionId: string,
  options: AppExecutionServiceOptions
): Promise<ExecutionTurnResult> {
  const execution = await options.agentExecutionStore.get(executionId);

  if (execution === null) {
    throw new Error(`Agent execution ${executionId} was not found.`);
  }

  const thread = await loadThread(execution.threadId, options.threadStore);

  if (execution.status === agentExecutionStatus.awaitingApproval) {
    const pendingDecision = await options.agentExecutionDecisionStore.getPendingByExecution(
      execution.executionId
    );

    return {
      thread,
      execution,
      route: null,
      finalOutput: null,
      lastResponseId: thread.lastResponseId,
      activeAgentId: execution.activeAgentId,
      activeAgentName: execution.activeAgentId,
      usedTools: [],
      pendingDecision
    };
  }

  if (execution.checkpoint.runState !== null) {
    return await continueInterruptedExecution({
      execution,
      thread,
      decision: null,
      options
    });
  }

  return await runFreshExecution({
    execution,
    thread,
    route:
      execution.checkpoint.routeKind === null
        ? null
        : {
            kind: execution.checkpoint.routeKind as TriggerRouteResult["kind"],
            thread
          },
    options,
    createPendingDecision
  });
}
