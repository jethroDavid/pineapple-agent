import type { FastifyBaseLogger } from "fastify";
import { z } from "zod";

import type { AppAdapter } from "../app-adapter.js";
import type { AppExecutionService } from "../../execution/pipeline/service.js";
import { trace, traceError } from "../../utils/trace.js";
import {
  createCronReminderJobDefinition,
  createCronReminderTriggerEvent,
  resolveCronReminderRouting
} from "./cron-reminder.js";
import { createCronDeleteJobTool } from "./cron-delete-job-tool.js";
import type { CronJobStore } from "./cron-job-store.js";
import { createCronListJobsTool } from "./cron-list-jobs-tool.js";
import { createCronScheduleReminderTool } from "./cron-schedule-reminder-tool.js";
import { CronScheduler } from "./cron-scheduler.js";

interface CronAdapterOptions {
  enabled?: boolean | null;
  jobsJson?: string | null;
  jobStore?: CronJobStore;
}

const cronConfiguredJobSchema = z
  .object({
    id: z.string().min(1),
    expression: z.string().min(1),
    message: z.string().min(1),
    instructions: z.string().min(1).optional(),
    agent_id: z.string().min(1).optional(),
    thread_id: z.uuid().optional(),
    subject_type: z.string().min(1).optional(),
    subject_id: z.string().min(1).optional(),
    allow_unbound_thread: z.boolean().optional(),
    max_runs: z.number().int().positive().optional()
  })
  .superRefine((input, ctx) => {
    if ((input.subject_type === undefined) !== (input.subject_id === undefined)) {
      ctx.addIssue({
        code: "custom",
        path: input.subject_type === undefined ? ["subject_type"] : ["subject_id"],
        message: "subject_type and subject_id must be provided together."
      });
    }
  });

type CronConfiguredJob = z.infer<typeof cronConfiguredJobSchema>;

const cronConfiguredJobsSchema = z.array(cronConfiguredJobSchema);

export function createCronAdapter(options: CronAdapterOptions): AppAdapter | null {
  const normalized = normalizeCronAdapterOptions(options);

  if (normalized === null) {
    return null;
  }

  if (options.jobStore === undefined) {
    throw new Error("Cron adapter requires a persistent job store when enabled.");
  }

  let logger: FastifyBaseLogger | null = null;
  let execution: AppExecutionService | null = null;

  const scheduler = new CronScheduler(
    async (job, scheduledAt) => {
      if (execution === null) {
        throw new Error("Execution service is not configured.");
      }

      const triggerEvent = createCronReminderTriggerEvent(job, scheduledAt);

      logger?.debug(
        {
          jobId: job.id,
          expression: job.expression,
          scheduledAt: scheduledAt.toISOString(),
          triggerId: triggerEvent.trigger_id
        },
        "Cron job fired."
      );
      trace("cron", "fired", {
        jobId: job.id,
        expression: job.expression,
        scheduledAt: scheduledAt.toISOString(),
        triggerId: triggerEvent.trigger_id
      });

      execution.enqueueTrigger(
        triggerEvent,
        (error) => {
          logger?.error(
            {
              ...(error instanceof Error ? { err: error } : { error }),
              jobId: job.id,
              triggerId: triggerEvent.trigger_id
            },
            "Cron trigger execution failed."
          );
          traceError("cron", "trigger failed", error, {
            jobId: job.id,
            triggerId: triggerEvent.trigger_id
          });
        },
        (result) => {
          logger?.debug(
            {
              jobId: job.id,
              triggerId: triggerEvent.trigger_id,
              executionId: result.execution.executionId,
              executionStatus: result.execution.status
            },
            "Cron trigger enqueued successfully."
          );
          trace("cron", "trigger queued", {
            jobId: job.id,
            triggerId: triggerEvent.trigger_id,
            executionId: result.execution.executionId,
            executionStatus: result.execution.status
          });
        }
      );
    },
    {
      store: options.jobStore
    }
  );

  return {
    name: "cron",
    getDatabaseRequirements() {
      return [
        {
          relation: "cron_jobs"
        }
      ];
    },
    getTools() {
      return [
        createCronListJobsTool({
          scheduler
        }),
        createCronDeleteJobTool({
          scheduler
        }),
        createCronScheduleReminderTool({
          scheduler,
          onScheduled(event) {
            logger?.info(
              {
                jobId: event.jobId,
                expression: event.expression,
                oneShot: event.oneShot,
                nextRunAt: event.nextRunAt,
                threadId: event.threadId
              },
              "Cron reminder scheduled."
            );
          }
        })
      ];
    },
    registerRoutes(_app, _context) {},
    async initialize(context) {
      logger = context.logger;
      execution = context.execution;

      if (execution === null) {
        throw new Error("Cron adapter requires execution service to be configured.");
      }

      await scheduler.loadJobs();
      for (const job of normalized.jobs) {
        await scheduler.upsertJob(toCronJobDefinition(job));
      }
      scheduler.start();
      trace("cron", "adapter initialized", {
        configuredJobCount: normalized.jobs.length
      });
      context.logger.info(
        {
          configuredJobCount: normalized.jobs.length
        },
        "Cron adapter initialized."
      );
    }
  };
}

function normalizeCronAdapterOptions(options: CronAdapterOptions): {
  jobs: CronConfiguredJob[];
} | null {
  if (options.enabled === false) {
    return null;
  }

  const enabled = options.enabled === true;
  const jobsJson = options.jobsJson?.trim() ?? "";

  if (!enabled && jobsJson.length === 0) {
    return null;
  }

  const jobs = jobsJson.length === 0 ? [] : parseCronConfiguredJobs(jobsJson);

  return {
    jobs
  };
}

function parseCronConfiguredJobs(raw: string): CronConfiguredJob[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `CRON_JOBS_JSON must be valid JSON. ${(error as Error).message}`
    );
  }

  return cronConfiguredJobsSchema.parse(parsed);
}

function toCronJobDefinition(job: CronConfiguredJob) {
  return createCronReminderJobDefinition({
    id: job.id,
    expression: job.expression,
    message: job.message,
    instructions: job.instructions,
    agentId: job.agent_id,
    routing: resolveCronReminderRouting({
      threadId: job.thread_id,
      subjectType: job.subject_type,
      subjectId: job.subject_id,
      allowUnboundThread: job.allow_unbound_thread
    }),
    maxRuns: job.max_runs
  });
}
