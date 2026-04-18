import {
  createAgentExecutionDecision,
  resolveAgentExecutionDecision,
  restoreAgentExecutionDecision,
  type AgentExecutionDecision,
  type AgentExecutionDecisionResolution,
  type NewAgentExecutionDecision
} from "../../src/execution/domain/agent-execution-decision.js";
import {
  createAgentExecution,
  restoreAgentExecution,
  type AgentExecution,
  type AgentExecutionStatus,
  type NewAgentExecution
} from "../../src/execution/domain/agent-execution.js";
import type { AgentExecutionDecisionStore } from "../../src/execution/store/agent-execution-decision-store.js";
import type { AgentExecutionStore } from "../../src/execution/store/agent-execution-store.js";

export class InMemoryAgentExecutionStore implements AgentExecutionStore {
  readonly records = new Map<string, AgentExecution>();

  async create(input: NewAgentExecution): Promise<AgentExecution> {
    const execution = createAgentExecution(input);
    this.records.set(execution.executionId, execution);
    return execution;
  }

  async get(executionId: string): Promise<AgentExecution | null> {
    return this.records.get(executionId) ?? null;
  }

  async getActiveByThread(threadId: string): Promise<AgentExecution | null> {
    for (const execution of this.records.values()) {
      if (
        execution.threadId === threadId &&
        ["queued", "running", "awaiting_approval"].includes(execution.status)
      ) {
        return execution;
      }
    }

    return null;
  }

  async listByStatuses(statuses: AgentExecutionStatus[]): Promise<AgentExecution[]> {
    return [...this.records.values()].filter((execution) =>
      statuses.includes(execution.status)
    );
  }

  async update(execution: AgentExecution): Promise<void> {
    this.records.set(execution.executionId, restoreAgentExecution(execution));
  }
}

export class InMemoryAgentExecutionDecisionStore
  implements AgentExecutionDecisionStore {
  readonly records = new Map<string, AgentExecutionDecision>();

  async create(input: NewAgentExecutionDecision): Promise<AgentExecutionDecision> {
    const decision = createAgentExecutionDecision(input);
    this.records.set(decision.decisionId, decision);
    return decision;
  }

  async get(decisionId: string): Promise<AgentExecutionDecision | null> {
    return this.records.get(decisionId) ?? null;
  }

  async getPendingByExecution(executionId: string): Promise<AgentExecutionDecision | null> {
    for (const decision of this.records.values()) {
      if (decision.executionId === executionId && decision.status === "pending") {
        return decision;
      }
    }

    return null;
  }

  async resolve(
    decisionId: string,
    resolution: AgentExecutionDecisionResolution
  ): Promise<AgentExecutionDecision> {
    const existing = this.records.get(decisionId);

    if (!existing) {
      throw new Error(`Decision ${decisionId} not found.`);
    }

    const resolved = resolveAgentExecutionDecision(existing, resolution);
    this.records.set(decisionId, resolved);
    return restoreAgentExecutionDecision(resolved);
  }
}
