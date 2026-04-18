import type {
  AgentExecution,
  AgentExecutionStatus,
  NewAgentExecution
} from "../domain/agent-execution.js";

export interface AgentExecutionStore {
  create(input: NewAgentExecution): Promise<AgentExecution>;
  get(executionId: string): Promise<AgentExecution | null>;
  getActiveByThread(threadId: string): Promise<AgentExecution | null>;
  listByStatuses(statuses: AgentExecutionStatus[]): Promise<AgentExecution[]>;
  update(execution: AgentExecution): Promise<void>;
}
