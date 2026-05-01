import type {
  CronJobStore,
  StoredCronJob
} from "../../src/adapters/cron/cron-job-store.js";

export class InMemoryCronJobStore implements CronJobStore {
  private readonly jobs = new Map<string, StoredCronJob>();

  async listActive(): Promise<StoredCronJob[]> {
    return Array.from(this.jobs.values())
      .map(cloneStoredCronJob)
      .sort((left, right) => left.nextRunAt.getTime() - right.nextRunAt.getTime());
  }

  async save(job: StoredCronJob): Promise<void> {
    this.jobs.set(job.definition.id, cloneStoredCronJob(job));
  }

  async delete(jobId: string): Promise<boolean> {
    return this.jobs.delete(jobId);
  }
}

function cloneStoredCronJob(job: StoredCronJob): StoredCronJob {
  return {
    definition: {
      ...job.definition,
      metadata: {
        ...job.definition.metadata
      }
    },
    nextRunAt: new Date(job.nextRunAt.getTime()),
    runCount: job.runCount
  };
}
