import type { AgentThread, NewAgentThread } from "../domain/agent-thread.js";

export interface AgentThreadStore {
  get(threadId: string): Promise<AgentThread | null>;
  create(input: NewAgentThread): Promise<AgentThread>;
  update(agentThread: AgentThread): Promise<void>;
}
