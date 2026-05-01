import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createCronReminderJobDefinition
} from "../../src/adapters/cron/cron-reminder.js";
import { CronScheduler } from "../../src/adapters/cron/cron-scheduler.js";
import { InMemoryCronJobStore } from "../support/in-memory-cron-job-store.js";

describe("CronScheduler persistence", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-19T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads persisted active jobs into a new scheduler", async () => {
    const store = new InMemoryCronJobStore();
    const firstScheduler = new CronScheduler(async () => undefined, {
      store
    });

    await firstScheduler.addJob(
      createCronReminderJobDefinition({
        id: "reminder:persisted",
        expression: "*/10 * * * * *",
        message: "Persist me",
        routing: {
          allowUnboundThread: true
        }
      })
    );

    const reloadedScheduler = new CronScheduler(async () => undefined, {
      store
    });
    const jobs = await reloadedScheduler.loadJobs();

    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.id).toBe("reminder:persisted");
    expect(jobs[0]?.nextRunAt).toBe("2026-04-19T00:00:10.000Z");
  });

  it("persists recurring run count and next run after firing", async () => {
    const store = new InMemoryCronJobStore();
    const scheduler = new CronScheduler(async () => undefined, {
      store
    });

    await scheduler.addJob(
      createCronReminderJobDefinition({
        id: "reminder:recurring",
        expression: "*/10 * * * * *",
        message: "Recurring",
        routing: {
          allowUnboundThread: true
        }
      })
    );
    scheduler.start();

    await vi.advanceTimersByTimeAsync(10_100);

    const jobs = await store.listActive();
    expect(jobs[0]?.runCount).toBe(1);
    expect(jobs[0]?.nextRunAt.toISOString()).toBe("2026-04-19T00:00:20.000Z");
  });

  it("removes completed one-shot jobs from active storage", async () => {
    const store = new InMemoryCronJobStore();
    const scheduler = new CronScheduler(async () => undefined, {
      store
    });

    await scheduler.addJob(
      createCronReminderJobDefinition({
        id: "reminder:once",
        expression: "*/10 * * * * *",
        message: "Once",
        routing: {
          allowUnboundThread: true
        },
        maxRuns: 1
      })
    );
    scheduler.start();

    await vi.advanceTimersByTimeAsync(10_100);

    expect(await store.listActive()).toEqual([]);
    expect(scheduler.listJobs()).toEqual([]);
  });
});
