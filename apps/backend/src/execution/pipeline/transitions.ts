import {
  agentExecutionStatus,
  type AgentExecution
} from "../domain/agent-execution.js";

export function markExecutionRunning(execution: AgentExecution): AgentExecution {
  const now = new Date();

  return {
    ...execution,
    status: agentExecutionStatus.running,
    startedAt: execution.startedAt ?? now,
    updatedAt: now
  };
}

export function finishExecution(
  execution: AgentExecution,
  options: {
    status: AgentExecution["status"];
    activeAgentId?: string;
    runState?: string | null;
    errorCode?: string | null;
    errorMessage?: string | null;
  }
): AgentExecution {
  const now = new Date();

  return {
    ...execution,
    status: options.status,
    activeAgentId: options.activeAgentId ?? execution.activeAgentId,
    checkpoint: {
      ...execution.checkpoint,
      runState: options.runState ?? null
    },
    errorCode: options.errorCode ?? null,
    errorMessage: options.errorMessage ?? null,
    endedAt:
      options.status === agentExecutionStatus.awaitingApproval ? null : now,
    updatedAt: now
  };
}

export function cancelExecutionAfterTerminalDecision(
  execution: AgentExecution
): AgentExecution {
  const now = new Date();

  return {
    ...execution,
    status: agentExecutionStatus.canceled,
    checkpoint: {
      ...execution.checkpoint,
      runState: null
    },
    endedAt: now,
    updatedAt: now
  };
}
