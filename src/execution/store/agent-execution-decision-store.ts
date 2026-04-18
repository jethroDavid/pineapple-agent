import type {
  AgentExecutionDecision,
  AgentExecutionDecisionResolution,
  NewAgentExecutionDecision
} from "../domain/agent-execution-decision.js";

export interface AgentExecutionDecisionStore {
  create(input: NewAgentExecutionDecision): Promise<AgentExecutionDecision>;
  get(decisionId: string): Promise<AgentExecutionDecision | null>;
  getPendingByExecution(executionId: string): Promise<AgentExecutionDecision | null>;
  resolve(
    decisionId: string,
    resolution: AgentExecutionDecisionResolution
  ): Promise<AgentExecutionDecision>;
}
