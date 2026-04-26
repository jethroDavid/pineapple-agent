import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCronListJobsTool } from "../../src/adapters/cron/cron-list-jobs-tool.js";
import {
  createCronReminderJobDefinition,
  resolveCronReminderRouting
} from "../../src/adapters/cron/cron-reminder.js";
import { CronScheduler } from "../../src/adapters/cron/cron-scheduler.js";

describe("cron_list_jobs tool", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-19T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createTool() {
    const scheduler = new CronScheduler(async () => undefined);
    const tool = createCronListJobsTool({
      scheduler
    });

    return {
      scheduler,
      tool
    };
  }

  it("returns an empty list when no cron jobs are scheduled", async () => {
    const { tool } = createTool();

    const output = await tool.execute(tool.inputSchema.parse({}));

    expect(output).toEqual({
      ok: true,
      count: 0,
      jobs: []
    });
  });

  it("lists active cron jobs with ids, next runs, messages, and routing", async () => {
    const { scheduler, tool } = createTool();

    scheduler.addJob(
      createCronReminderJobDefinition({
        id: "reminder:standup",
        expression: "*/10 * * * * *",
        message: "Daily standup",
        agentId: "scheduler",
        routing: resolveCronReminderRouting({
          threadId: "1e012cb8-f42e-42e7-839f-ed65eec2d958"
        }),
        maxRuns: 1
      })
    );
    scheduler.addJob(
      createCronReminderJobDefinition({
        id: "reminder:heartbeat",
        expression: "*/30 * * * * *",
        message: "Heartbeat",
        routing: resolveCronReminderRouting({
          allowUnboundThread: true
        })
      })
    );

    const output = await tool.execute(tool.inputSchema.parse({}));

    expect(output.ok).toBe(true);
    expect(output.count).toBe(2);
    expect(output.jobs).toEqual([
      {
        job_id: "reminder:standup",
        expression: "*/10 * * * * *",
        one_shot: true,
        max_runs: 1,
        run_count: 0,
        next_run_at: "2026-04-19T00:00:10.000Z",
        message: "Daily standup",
        agent_id: "scheduler",
        routing: {
          thread_id: "1e012cb8-f42e-42e7-839f-ed65eec2d958",
          subject_type: null,
          subject_id: null,
          allow_unbound_thread: false
        }
      },
      {
        job_id: "reminder:heartbeat",
        expression: "*/30 * * * * *",
        one_shot: false,
        max_runs: null,
        run_count: 0,
        next_run_at: "2026-04-19T00:00:30.000Z",
        message: "Heartbeat",
        agent_id: null,
        routing: {
          thread_id: null,
          subject_type: null,
          subject_id: null,
          allow_unbound_thread: true
        }
      }
    ]);
  });
});
