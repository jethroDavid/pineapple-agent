import { describe, expect, it } from "vitest";

import { createCronDeleteJobTool } from "../../src/adapters/cron/cron-delete-job-tool.js";
import { createCronReminderJobDefinition } from "../../src/adapters/cron/cron-reminder.js";
import { CronScheduler } from "../../src/adapters/cron/cron-scheduler.js";

describe("cron_delete_job tool", () => {
  function createTool() {
    const scheduler = new CronScheduler(async () => undefined);
    const tool = createCronDeleteJobTool({
      scheduler
    });

    return {
      scheduler,
      tool
    };
  }

  it("deletes an active cron job by id", async () => {
    const { scheduler, tool } = createTool();
    scheduler.addJob(
      createCronReminderJobDefinition({
        id: "reminder:follow-up",
        expression: "*/10 * * * * *",
        message: "Follow up",
        routing: {
          allowUnboundThread: true
        }
      })
    );

    const output = await tool.execute(
      tool.inputSchema.parse({
        job_id: "reminder:follow-up"
      })
    );

    expect(output).toEqual({
      ok: true,
      job_id: "reminder:follow-up",
      deleted: true
    });
    expect(scheduler.listJobs()).toEqual([]);
  });

  it("reports false when the job does not exist", async () => {
    const { tool } = createTool();

    await expect(
      tool.execute(
        tool.inputSchema.parse({
          job_id: "reminder:missing"
        })
      )
    ).resolves.toEqual({
      ok: true,
      job_id: "reminder:missing",
      deleted: false
    });
  });
});
