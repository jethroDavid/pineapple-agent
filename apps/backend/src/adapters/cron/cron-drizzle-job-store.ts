import { and, eq, isNull } from "drizzle-orm";

import { getDb } from "../../db/client.js";
import { cronJobs } from "./cron-db-schema.js";
import type {
  CronJobStore,
  StoredCronJob
} from "./cron-job-store.js";

export class DrizzleCronJobStore implements CronJobStore {
  async listActive(): Promise<StoredCronJob[]> {
    const db = getDb();
    const records = await db
      .select()
      .from(cronJobs)
      .where(isNull(cronJobs.deletedAt))
      .orderBy(cronJobs.nextRunAt);

    return records.map((record) => ({
      definition: {
        id: record.jobId,
        expression: record.expression,
        maxRuns: record.maxRuns ?? undefined,
        metadata: record.metadata
      },
      nextRunAt: record.nextRunAt,
      runCount: record.runCount
    }));
  }

  async save(job: StoredCronJob): Promise<void> {
    const db = getDb();
    const now = new Date();

    await db
      .insert(cronJobs)
      .values({
        jobId: job.definition.id,
        expression: job.definition.expression,
        maxRuns: job.definition.maxRuns ?? null,
        runCount: job.runCount,
        nextRunAt: job.nextRunAt,
        metadata: job.definition.metadata,
        deletedAt: null,
        createdAt: now,
        updatedAt: now
      })
      .onConflictDoUpdate({
        target: cronJobs.jobId,
        set: {
          expression: job.definition.expression,
          maxRuns: job.definition.maxRuns ?? null,
          runCount: job.runCount,
          nextRunAt: job.nextRunAt,
          metadata: job.definition.metadata,
          deletedAt: null,
          updatedAt: now
        }
      });
  }

  async delete(jobId: string, deletedAt: Date): Promise<boolean> {
    const db = getDb();
    const records = await db
      .update(cronJobs)
      .set({
        deletedAt,
        updatedAt: deletedAt
      })
      .where(and(eq(cronJobs.jobId, jobId), isNull(cronJobs.deletedAt)))
      .returning({
        jobId: cronJobs.jobId
      });

    return records.length > 0;
  }
}
