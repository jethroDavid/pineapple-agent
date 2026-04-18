import {
  createAgentThread,
  restoreAgentThread,
  type AgentThread,
  type NewAgentThread
} from "../../src/agents/domain/agent-thread.js";
import {
  createSpecialistSession,
  restoreSpecialistSession,
  type SpecialistSession
} from "../../src/agents/domain/specialist-session.js";
import type { AgentThreadStore } from "../../src/agents/store/agent-thread-store.js";
import type {
  SpecialistSessionStore,
  UpsertSpecialistSessionInput
} from "../../src/agents/store/specialist-session-store.js";

export class InMemoryAgentThreadStore implements AgentThreadStore {
  readonly records = new Map<string, AgentThread>();

  async get(threadId: string): Promise<AgentThread | null> {
    return this.records.get(threadId) ?? null;
  }

  async create(input: NewAgentThread): Promise<AgentThread> {
    const thread = createAgentThread(input);
    this.records.set(thread.threadId, thread);
    return thread;
  }

  async update(agentThread: AgentThread): Promise<void> {
    this.records.set(agentThread.threadId, restoreAgentThread(agentThread));
  }
}

export class InMemorySpecialistSessionStore implements SpecialistSessionStore {
  readonly records = new Map<string, SpecialistSession>();

  async getByThreadAndAgent(threadId: string, agentId: string): Promise<SpecialistSession | null> {
    return this.records.get(sessionKey(threadId, agentId)) ?? null;
  }

  async listByThread(threadId: string): Promise<SpecialistSession[]> {
    return [...this.records.values()]
      .filter((session) => session.threadId === threadId)
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
  }

  async upsert(input: UpsertSpecialistSessionInput): Promise<SpecialistSession> {
    const key = sessionKey(input.threadId, input.agentId);
    const existing = this.records.get(key);

    if (!existing) {
      const created = createSpecialistSession(input);
      this.records.set(key, created);
      return created;
    }

    const updated = restoreSpecialistSession({
      ...existing,
      provider: input.provider,
      providerThreadId: input.providerThreadId ?? null,
      state: input.state ?? existing.state,
      updatedAt: new Date()
    });

    this.records.set(key, updated);
    return updated;
  }
}

function sessionKey(threadId: string, agentId: string): string {
  return `${threadId}:${agentId}`;
}
