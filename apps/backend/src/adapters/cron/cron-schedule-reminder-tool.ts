import { z } from "zod";

import type { ToolDefinition } from "../../tools/tool-definition.js";
import { trace } from "../../utils/trace.js";
import type { CronScheduler } from "./cron-scheduler.js";
import { resolveCronReminderExpression } from "./cron-reminder-expression.js";
import {
  createCronReminderJobDefinition,
  resolveCronReminderRouting
} from "./cron-reminder.js";

const cronScheduleReminderInputSchema = z.object({
  expression: z.string().min(1),
  message: z.string().min(1),
  one_time: z.boolean(),
  agent_id: z.string().min(1).optional()
});

const cronScheduleReminderOutputSchema = z.object({
  ok: z.literal(true),
  job_id: z.string().min(1),
  expression: z.string().min(1),
  one_shot: z.boolean(),
  next_run_at: z.string().min(1),
  agent_id: z.string().min(1).nullable(),
  routing: z.object({
    thread_id: z.string().min(1).nullable(),
    subject_type: z.string().min(1).nullable(),
    subject_id: z.string().min(1).nullable(),
    allow_unbound_thread: z.boolean()
  })
});

type CronScheduleReminderInput = z.infer<typeof cronScheduleReminderInputSchema>;
type CronScheduleReminderOutput = z.infer<typeof cronScheduleReminderOutputSchema>;

export function createCronScheduleReminderTool(options: {
  scheduler: CronScheduler;
  onScheduled?: (event: {
    jobId: string;
    expression: string;
    oneShot: boolean;
    nextRunAt: string;
    threadId: string | null;
  }) => void;
}): ToolDefinition<CronScheduleReminderInput, CronScheduleReminderOutput> {
  return {
    name: "cron_schedule_reminder",
    description:
      "Schedule a reminder. Use a cron expression when you have one, or plain text like 'in 15 seconds'. Optionally include agent_id to target a specialist. Example: {\"expression\":\"*/15 * * * * *\",\"message\":\"Follow up\",\"one_time\":true}",
    inputSchema: cronScheduleReminderInputSchema,
    outputSchema: cronScheduleReminderOutputSchema,
    sideEffecting: true,
    approvalRequired: false,
    idempotent: false,
    async execute(input, context) {
      const normalizedExpression = resolveCronReminderExpression(input.expression, {
        oneShot: input.one_time
      });
      const routing = resolveCronReminderRouting({
        contextThreadId: context?.threadId
      });
      const oneShot = input.one_time;
      const job = createCronReminderJobDefinition({
        id: `reminder:${crypto.randomUUID()}`,
        expression: normalizedExpression,
        message: input.message,
        agentId: input.agent_id,
        routing,
        maxRuns: oneShot ? 1 : undefined
      });
      const snapshot = await options.scheduler.addJob(job);

      trace("tool:cron_schedule_reminder", "scheduled", {
        jobId: snapshot.id,
        expression: snapshot.expression,
        oneShot,
        nextRunAt: snapshot.nextRunAt,
        threadId: routing.threadId ?? null
      });

      options.onScheduled?.({
        jobId: snapshot.id,
        expression: snapshot.expression,
        oneShot,
        nextRunAt: snapshot.nextRunAt,
        threadId: routing.threadId ?? null
      });

      return {
        ok: true,
        job_id: snapshot.id,
        expression: snapshot.expression,
        one_shot: oneShot,
        next_run_at: snapshot.nextRunAt,
        agent_id: input.agent_id ?? null,
        routing: {
          thread_id: routing.threadId ?? null,
          subject_type: routing.subjectType ?? null,
          subject_id: routing.subjectId ?? null,
          allow_unbound_thread: routing.allowUnboundThread
        }
      };
    }
  };
}
