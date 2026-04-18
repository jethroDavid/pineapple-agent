import { eq } from "drizzle-orm";

import {
  createAgentThread,
  restoreAgentThread,
  type AgentThread,
  type NewAgentThread
} from "../../agents/domain/agent-thread.js";
import type { AgentThreadStore } from "../../agents/store/agent-thread-store.js";
import { getDb } from "../client.js";
import { agentThreads } from "../schema.js";

export class DrizzleAgentThreadStore implements AgentThreadStore {
  async get(threadId: string): Promise<AgentThread | null> {
    const db = getDb();
    const [record] = await db
      .select()
      .from(agentThreads)
      .where(eq(agentThreads.threadId, threadId))
      .limit(1);

    return record
      ? restoreAgentThread({
          ...record,
          sessionItems: record.sessionItems as never
        })
      : null;
  }

  async create(input: NewAgentThread): Promise<AgentThread> {
    const db = getDb();
    const agentThread = createAgentThread(input);
    const [record] = await db
      .insert(agentThreads)
      .values({
        ...agentThread,
        sessionItems: agentThread.sessionItems as unknown[]
      })
      .returning();

    if (!record) {
      throw new Error("Failed to create agent thread.");
    }

    return restoreAgentThread({
      ...record,
      sessionItems: record.sessionItems as never
    });
  }

  async update(agentThread: AgentThread): Promise<void> {
    const db = getDb();
    const record = restoreAgentThread(agentThread);

    await db
      .update(agentThreads)
      .set({
        entrypointAgentId: record.entrypointAgentId,
        activeAgentId: record.activeAgentId,
        sessionItems: record.sessionItems as unknown[],
        createdAt: record.createdAt,
        updatedAt: record.updatedAt
      })
      .where(eq(agentThreads.threadId, record.threadId));
  }
}
