import { describe, expect, it } from "vitest";

import { createCronScheduleReminderTool } from "../../src/adapters/cron/cron-schedule-reminder-tool.js";
import { CronScheduler } from "../../src/adapters/cron/cron-scheduler.js";
import { toAgentFunctionTool } from "../../src/agents/runtime/agent-runtime-tool.js";
import { InMemoryCronJobStore } from "../support/in-memory-cron-job-store.js";

describe("cron_schedule_reminder tool", () => {
  function createTool() {
    const scheduler = new CronScheduler(async () => undefined, {
      store: new InMemoryCronJobStore()
    });
    const tool = createCronScheduleReminderTool({
      scheduler
    });

    return {
      scheduler,
      tool
    };
  }

  it("schedules one-time reminders when one_time=true", async () => {
    const { scheduler, tool } = createTool();

    const input = tool.inputSchema.parse({
      expression: "*/10 * * * * *",
      one_time: true,
      message: "One-shot reminder",
      agent_id: null
    });
    const output = await tool.execute(input, {
      threadId: "1e012cb8-f42e-42e7-839f-ed65eec2d958"
    });

    expect(output.ok).toBe(true);
    expect(output.one_shot).toBe(true);
    expect(output.agent_id).toBeNull();
    expect(output.routing.thread_id).toBe("1e012cb8-f42e-42e7-839f-ed65eec2d958");
    expect(scheduler.listJobs()).toHaveLength(1);
    expect(scheduler.listJobs()[0]?.maxRuns).toBe(1);
  });

  it("emits a strict OpenAI function schema for nullable agent targets", () => {
    const { tool } = createTool();
    const agentTool = toAgentFunctionTool(tool);

    expect(agentTool.type).toBe("function");
    if (agentTool.type !== "function") {
      throw new Error("Expected cron_schedule_reminder to be a function tool.");
    }

    expect((agentTool.parameters as { required?: string[] }).required).toEqual([
      "expression",
      "message",
      "one_time",
      "agent_id"
    ]);
  });

  it("supports scheduling for a target agent", async () => {
    const { scheduler, tool } = createTool();

    const output = await tool.execute(
      tool.inputSchema.parse({
        expression: "*/10 * * * * *",
        one_time: true,
        message: "Review this",
        agent_id: "codex"
      })
    );

    expect(output.agent_id).toBe("codex");
    expect(scheduler.listJobs()[0]?.metadata.agentId).toBe("codex");
  });

  it("schedules recurring reminders with cron expressions", async () => {
    const { scheduler, tool } = createTool();

    const input = tool.inputSchema.parse({
      expression: "0 0 */1 * * *",
      one_time: false,
      message: "Hourly reminder",
      agent_id: null
    });
    const output = await tool.execute(input);

    expect(output.ok).toBe(true);
    expect(output.one_shot).toBe(false);
    expect(output.expression).toBe("0 0 */1 * * *");
    expect(output.routing.allow_unbound_thread).toBe(true);
    expect(scheduler.listJobs()).toHaveLength(1);
    expect(scheduler.listJobs()[0]?.maxRuns).toBeNull();
  });

  it("supports recurring natural language expressions", async () => {
    const { tool } = createTool();

    const output = await tool.execute(
      tool.inputSchema.parse({
        expression: "every 5 minutes!",
        one_time: false,
        message: "Hydrate",
        agent_id: null
      })
    );

    expect(output.expression).toBe("0 */5 * * * *");
    expect(output.one_shot).toBe(false);
  });

  it("rejects zero and negative natural language amounts", async () => {
    const { tool } = createTool();

    await expect(
      tool.execute(
        tool.inputSchema.parse({
          expression: "in 0 minutes",
          one_time: true,
          message: "No-op",
          agent_id: null
        })
      )
    ).rejects.toThrow("Expression amount must be greater than zero.");
  });

  it("rejects unsupported recurring day/week intervals", async () => {
    const { tool } = createTool();

    await expect(
      tool.execute(
        tool.inputSchema.parse({
          expression: "every 2 weeks",
          one_time: false,
          message: "Biweekly",
          agent_id: null
        })
      )
    ).rejects.toThrow(
      "Recurring intervals longer than one week are not represented precisely in cron. Use an explicit cron expression."
    );
  });
});
