import type { CronJobDefinition } from "./cron-scheduler.js";

export interface StoredCronJob {
  definition: CronJobDefinition;
  nextRunAt: Date;
  runCount: number;
}

export interface CronJobStore {
  listActive(): Promise<StoredCronJob[]>;
  save(job: StoredCronJob): Promise<void>;
  delete(jobId: string, deletedAt: Date): Promise<boolean>;
}
