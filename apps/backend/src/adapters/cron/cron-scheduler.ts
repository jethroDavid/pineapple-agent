import {
  getNextCronOccurrence,
  parseCronExpression,
  type ParsedCronExpression
} from "./cron-expression.js";
import { trace, traceError } from "../../utils/trace.js";

export interface CronJobDefinition {
  id: string;
  expression: string;
  maxRuns?: number;
  metadata: Record<string, unknown>;
}

interface ScheduledCronJob {
  definition: CronJobDefinition;
  parsedExpression: ParsedCronExpression;
  nextRunAt: Date;
  runCount: number;
}

export interface CronJobSnapshot {
  id: string;
  expression: string;
  maxRuns: number | null;
  runCount: number;
  nextRunAt: string;
  metadata: Record<string, unknown>;
}

export class CronScheduler {
  private readonly jobs = new Map<string, ScheduledCronJob>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  constructor(
    private readonly onTick: (job: CronJobDefinition, scheduledAt: Date) => Promise<void>
  ) {}

  start(): void {
    if (this.running) {
      return;
    }

    this.running = true;
    trace("cron", "scheduler started");
    this.scheduleNextTick();
  }

  stop(): void {
    this.running = false;

    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    trace("cron", "scheduler stopped");
  }

  addJob(definition: CronJobDefinition): CronJobSnapshot {
    if (this.jobs.has(definition.id)) {
      throw new Error(`Cron job ${definition.id} is already scheduled.`);
    }

    return this.upsertJob(definition);
  }

  upsertJob(definition: CronJobDefinition): CronJobSnapshot {
    const parsedExpression = parseCronExpression(definition.expression);
    const now = new Date();
    const nextRunAt = getNextCronOccurrence(parsedExpression, now);

    if (nextRunAt === null) {
      throw new Error(
        `Cron expression "${definition.expression}" did not produce a future run.`
      );
    }

    this.jobs.set(definition.id, {
      definition,
      parsedExpression,
      nextRunAt,
      runCount: 0
    });
    trace("cron", "job scheduled", {
      jobId: definition.id,
      expression: definition.expression,
      maxRuns: definition.maxRuns ?? null,
      nextRunAt: nextRunAt.toISOString()
    });

    this.scheduleNextTick();

    return this.toSnapshot(
      this.jobs.get(definition.id)!
    );
  }

  removeJob(jobId: string): boolean {
    const deleted = this.jobs.delete(jobId);

    if (deleted) {
      trace("cron", "job removed", {
        jobId
      });
      this.scheduleNextTick();
    }

    return deleted;
  }

  listJobs(): CronJobSnapshot[] {
    return Array.from(this.jobs.values())
      .sort((left, right) => left.nextRunAt.getTime() - right.nextRunAt.getTime())
      .map((job) => this.toSnapshot(job));
  }

  private scheduleNextTick(): void {
    if (!this.running) {
      return;
    }

    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    const nextJob = this.getNextJob();

    if (nextJob === null) {
      return;
    }

    const delayMs = Math.max(0, nextJob.nextRunAt.getTime() - Date.now());
    trace("cron", "next tick scheduled", {
      jobId: nextJob.definition.id,
      delayMs,
      runAt: nextJob.nextRunAt.toISOString()
    });
    this.timer = setTimeout(() => {
      void this.processDueJobs();
    }, delayMs);
    this.timer.unref?.();
  }

  private async processDueJobs(): Promise<void> {
    if (!this.running) {
      return;
    }

    const now = new Date();
    const dueJobs = Array.from(this.jobs.values()).filter(
      (job) => job.nextRunAt.getTime() <= now.getTime()
    );

    for (const job of dueJobs) {
      const scheduledAt = new Date(job.nextRunAt.getTime());
      try {
        await this.onTick(job.definition, scheduledAt);
      } catch (error) {
        traceError("cron", "tick handler failed", error, {
          jobId: job.definition.id,
          scheduledAt: scheduledAt.toISOString()
        });
        // Scheduler keeps advancing even when a single tick fails.
      }

      job.runCount += 1;

      if (isCronJobCompleted(job.definition, job.runCount)) {
        trace("cron", "job completed", {
          jobId: job.definition.id,
          runCount: job.runCount,
          maxRuns: job.definition.maxRuns ?? null
        });
        this.jobs.delete(job.definition.id);
        continue;
      }

      const nextRunAt = getNextCronOccurrence(job.parsedExpression, scheduledAt);

      if (nextRunAt === null) {
        trace("cron", "job ended: no future run", {
          jobId: job.definition.id,
          expression: job.definition.expression
        });
        this.jobs.delete(job.definition.id);
        continue;
      }

      job.nextRunAt = nextRunAt;
    }

    this.scheduleNextTick();
  }

  private getNextJob(): ScheduledCronJob | null {
    let selected: ScheduledCronJob | null = null;

    for (const job of this.jobs.values()) {
      if (selected === null || job.nextRunAt.getTime() < selected.nextRunAt.getTime()) {
        selected = job;
      }
    }

    return selected;
  }

  private toSnapshot(job: ScheduledCronJob): CronJobSnapshot {
    return {
      id: job.definition.id,
      expression: job.definition.expression,
      maxRuns: job.definition.maxRuns ?? null,
      runCount: job.runCount,
      nextRunAt: job.nextRunAt.toISOString(),
      metadata: job.definition.metadata
    };
  }
}

function isCronJobCompleted(definition: CronJobDefinition, runCount: number): boolean {
  if (definition.maxRuns === undefined) {
    return false;
  }

  return runCount >= definition.maxRuns;
}
