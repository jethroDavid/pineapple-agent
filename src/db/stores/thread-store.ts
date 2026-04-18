import { and, desc, eq, isNull } from "drizzle-orm";

import { createThread, restoreThread, type NewThread, type Thread } from "../../threads/domain/thread.js";
import type { ThreadStore } from "../../threads/store/thread-store.js";
import { getDb } from "../client.js";
import { threads } from "../schema.js";

export class DrizzleThreadStore implements ThreadStore {
  async get(threadId: string): Promise<Thread | null> {
    const db = getDb();
    const [record] = await db.select().from(threads).where(eq(threads.threadId, threadId)).limit(1);

    return record ? restoreThread(record) : null;
  }

  async listRecent(limit: number): Promise<Thread[]> {
    const db = getDb();
    const records = await db
      .select()
      .from(threads)
      .where(isNull(threads.closedAt))
      .orderBy(desc(threads.updatedAt), desc(threads.createdAt))
      .limit(limit);

    return records.map(restoreThread);
  }

  async findBySubject(subjectType: string, subjectId: string): Promise<Thread | null> {
    const db = getDb();
    const [record] = await db
      .select()
      .from(threads)
      .where(
        and(
          eq(threads.subjectType, subjectType),
          eq(threads.subjectId, subjectId)
        )
      )
      .orderBy(desc(threads.updatedAt), desc(threads.createdAt))
      .limit(1);

    return record ? restoreThread(record) : null;
  }

  async create(input: NewThread): Promise<Thread> {
    const db = getDb();
    const thread = createThread(input);
    const [record] = await db.insert(threads).values(thread).returning();

    if (!record) {
      throw new Error("Failed to create thread.");
    }

    return restoreThread(record);
  }

  async update(thread: Thread): Promise<void> {
    const db = getDb();
    const record = restoreThread(thread);

    await db
      .update(threads)
      .set({
        subjectType: record.subjectType,
        subjectId: record.subjectId,
        title: record.title,
        description: record.description,
        threadMetadata: record.threadMetadata,
        lastResponseId: record.lastResponseId,
        closedAt: record.closedAt,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt
      })
      .where(eq(threads.threadId, record.threadId));
  }
}
