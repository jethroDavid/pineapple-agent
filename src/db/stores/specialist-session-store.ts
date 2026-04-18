import { and, asc, eq } from "drizzle-orm";

import {
  createSpecialistSession,
  restoreSpecialistSession,
  type SpecialistSession
} from "../../agents/domain/specialist-session.js";
import type {
  SpecialistSessionStore,
  UpsertSpecialistSessionInput
} from "../../agents/store/specialist-session-store.js";
import type { JsonObject } from "../../shared/types/json.js";
import { getDb } from "../client.js";
import { specialistSessions } from "../schema.js";

export class DrizzleSpecialistSessionStore implements SpecialistSessionStore {
  async getByThreadAndAgent(threadId: string, agentId: string): Promise<SpecialistSession | null> {
    const db = getDb();
    const [record] = await db
      .select()
      .from(specialistSessions)
      .where(
        and(
          eq(specialistSessions.threadId, threadId),
          eq(specialistSessions.agentId, agentId)
        )
      )
      .limit(1);

    return record ? restoreSpecialistSession(record) : null;
  }

  async listByThread(threadId: string): Promise<SpecialistSession[]> {
    const db = getDb();
    const records = await db
      .select()
      .from(specialistSessions)
      .where(eq(specialistSessions.threadId, threadId))
      .orderBy(asc(specialistSessions.createdAt));

    return records.map(restoreSpecialistSession);
  }

  async upsert(input: UpsertSpecialistSessionInput): Promise<SpecialistSession> {
    const db = getDb();
    const existing = await this.getByThreadAndAgent(input.threadId, input.agentId);
    const record =
      existing === null
        ? createSpecialistSession({
            threadId: input.threadId,
            agentId: input.agentId,
            provider: input.provider,
            providerThreadId: input.providerThreadId ?? null,
            state: (input.state ?? {}) as JsonObject
          })
        : {
            ...existing,
            provider: input.provider,
            providerThreadId: input.providerThreadId ?? existing.providerThreadId,
            state: (input.state ?? existing.state) as JsonObject,
            updatedAt: new Date()
          };

    const [saved] = await db
      .insert(specialistSessions)
      .values(record)
      .onConflictDoUpdate({
        target: [specialistSessions.threadId, specialistSessions.agentId],
        set: {
          provider: record.provider,
          providerThreadId: record.providerThreadId,
          state: record.state,
          updatedAt: record.updatedAt
        }
      })
      .returning();

    if (!saved) {
      throw new Error("Failed to upsert specialist session.");
    }

    return restoreSpecialistSession(saved);
  }
}
