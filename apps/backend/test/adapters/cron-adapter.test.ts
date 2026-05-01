import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCronAdapter } from "../../src/adapters/cron/cron-adapter.js";
import { cronAdapterPlugin } from "../../src/adapters/cron/cron-adapter-plugin.js";
import type { TriggerEvent } from "../../src/execution/contracts/trigger-event.js";
import type { AppExecutionService } from "../../src/execution/pipeline/service.js";
import { InMemoryCronJobStore } from "../support/in-memory-cron-job-store.js";

describe("createCronAdapter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-19T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null when cron is not enabled and has no configured jobs", () => {
    expect(createCronAdapter({})).toBeNull();
  });

  it("returns null when cron is explicitly disabled even with configured jobs", () => {
    expect(
      createCronAdapter({
        enabled: false,
        jobsJson: JSON.stringify([
          {
            id: "heartbeat",
            expression: "*/2 * * * * *",
            message: "Heartbeat reminder"
          }
        ])
      })
    ).toBeNull();
  });

  it("auto-enables cron when configured jobs are provided", () => {
    expect(
      createCronAdapter({
        jobStore: new InMemoryCronJobStore(),
        jobsJson: JSON.stringify([
          {
            id: "heartbeat",
            expression: "*/2 * * * * *",
            message: "Heartbeat reminder"
          }
        ])
      })
    ).not.toBeNull();
  });

  it("does not require host-provided storage dependencies when created through the plugin", () => {
    expect(() =>
      cronAdapterPlugin.create({
        threadStore: {} as never
      })
    ).not.toThrow();
  });

  it("exposes cron list and scheduling tools", () => {
    const adapter = createCronAdapter({
      enabled: true,
      jobStore: new InMemoryCronJobStore()
    });

    expect(adapter?.getTools().map((tool) => tool.name)).toEqual([
      "cron_list_jobs",
      "cron_delete_job",
      "cron_schedule_reminder"
    ]);
  });

  it("declares the cron jobs table requirement", () => {
    const adapter = createCronAdapter({
      enabled: true,
      jobStore: new InMemoryCronJobStore()
    });

    expect(adapter?.getDatabaseRequirements?.()).toEqual([
      {
        relation: "cron_jobs"
      }
    ]);
  });

  it("fires configured cron jobs and enqueues trigger events", async () => {
    const enqueuedTriggers: TriggerEvent[] = [];
    const adapter = createCronAdapter({
      enabled: true,
      jobStore: new InMemoryCronJobStore(),
      jobsJson: JSON.stringify([
        {
          id: "heartbeat",
          expression: "*/2 * * * * *",
          message: "Heartbeat reminder",
          allow_unbound_thread: true,
          agent_id: "codex"
        }
      ])
    });

    expect(adapter).not.toBeNull();

    await adapter!.initialize?.({
      logger: createFakeLogger(),
      execution: createFakeExecutionService(enqueuedTriggers)
    });

    await vi.advanceTimersByTimeAsync(2100);

    expect(enqueuedTriggers).toHaveLength(1);
    expect(enqueuedTriggers[0]).toMatchObject({
      source: {
        kind: "system",
        system: "pineapple-cron",
        event_type: "reminder.tick"
      },
      payload: {
        input: expect.stringContaining("Reminder: Heartbeat reminder"),
        agent_id: "codex"
      },
      routing: {
        allow_unbound_thread: true
      }
    });
  });

  it("targets Scheduler for configured reminder ticks without an explicit agent", async () => {
    const enqueuedTriggers: TriggerEvent[] = [];
    const adapter = createCronAdapter({
      enabled: true,
      jobStore: new InMemoryCronJobStore(),
      jobsJson: JSON.stringify([
        {
          id: "heartbeat",
          expression: "*/2 * * * * *",
          message: "Heartbeat reminder",
          allow_unbound_thread: true
        }
      ])
    });

    await adapter!.initialize?.({
      logger: createFakeLogger(),
      execution: createFakeExecutionService(enqueuedTriggers)
    });

    await vi.advanceTimersByTimeAsync(2100);

    expect(enqueuedTriggers[0]).toMatchObject({
      payload: {
        agent_id: "scheduler"
      }
    });
  });

  it("seeds configured cron jobs into the job store", async () => {
    const jobStore = new InMemoryCronJobStore();
    const adapter = createCronAdapter({
      enabled: true,
      jobStore,
      jobsJson: JSON.stringify([
        {
          id: "heartbeat",
          expression: "*/30 * * * * *",
          message: "Heartbeat reminder",
          allow_unbound_thread: true
        }
      ])
    });

    await adapter!.initialize?.({
      logger: createFakeLogger(),
      execution: createFakeExecutionService([])
    });

    const jobs = await jobStore.listActive();

    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.definition.id).toBe("heartbeat");
    expect(jobs[0]?.definition.metadata.message).toBe("Heartbeat reminder");
  });
});

function createFakeExecutionService(
  enqueuedTriggers: TriggerEvent[]
): AppExecutionService {
  return {
    getQueueStatus() {
      return {
        state: "idle",
        queueDepth: 0,
        processedCount: 0,
        failedCount: 0
      };
    },
    canResolveDecisions() {
      return false;
    },
    listAgents() {
      return [];
    },
    getAgentSummary() {
      return null;
    },
    hasAgent() {
      return false;
    },
    getEntrypointAgentId() {
      return null;
    },
    async submitTrigger() {
      throw new Error("Not used in cron adapter test.");
    },
    enqueueTrigger(triggerEvent) {
      enqueuedTriggers.push(triggerEvent);
    },
    async runTurn() {
      throw new Error("Not used in cron adapter test.");
    },
    async resolveDecision() {
      throw new Error("Not used in cron adapter test.");
    },
    async recoverActiveRuns() {
      return [];
    }
  };
}

function createFakeLogger() {
  return {
    level: "info",
    silent: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    debug: vi.fn(),
    child: vi.fn()
  } as never;
}
