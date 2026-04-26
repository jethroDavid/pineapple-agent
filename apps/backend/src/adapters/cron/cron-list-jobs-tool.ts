import { z } from "zod";

import type { ToolDefinition } from "../../tools/tool-definition.js";
import { trace } from "../../utils/trace.js";
import type { CronScheduler } from "./cron-scheduler.js";

const cronListJobsInputSchema = z.object({});

const cronJobRoutingOutputSchema = z.object({
  thread_id: z.string().min(1).nullable(),
  subject_type: z.string().min(1).nullable(),
  subject_id: z.string().min(1).nullable(),
  allow_unbound_thread: z.boolean()
});

const cronJobSummaryOutputSchema = z.object({
  job_id: z.string().min(1),
  expression: z.string().min(1),
  one_shot: z.boolean(),
  max_runs: z.number().int().positive().nullable(),
  run_count: z.number().int().nonnegative(),
  next_run_at: z.string().min(1),
  message: z.string().min(1).nullable(),
  agent_id: z.string().min(1).nullable(),
  routing: cronJobRoutingOutputSchema
});

const cronListJobsOutputSchema = z.object({
  ok: z.literal(true),
  count: z.number().int().nonnegative(),
  jobs: z.array(cronJobSummaryOutputSchema)
});

type CronListJobsInput = z.infer<typeof cronListJobsInputSchema>;
type CronListJobsOutput = z.infer<typeof cronListJobsOutputSchema>;

interface CronJobMetadataSummary {
  message: string | null;
  agentId: string | null;
  routing: z.infer<typeof cronJobRoutingOutputSchema>;
}

export function createCronListJobsTool(options: {
  scheduler: CronScheduler;
}): ToolDefinition<CronListJobsInput, CronListJobsOutput> {
  return {
    name: "cron_list_jobs",
    description:
      "List all active cron jobs/reminders, including job IDs, expressions, next run times, messages, and routing.",
    inputSchema: cronListJobsInputSchema,
    outputSchema: cronListJobsOutputSchema,
    sideEffecting: false,
    approvalRequired: false,
    idempotent: true,
    async execute() {
      const jobs = options.scheduler.listJobs().map((job) => {
        const metadata = summarizeCronJobMetadata(job.metadata);

        return {
          job_id: job.id,
          expression: job.expression,
          one_shot: job.maxRuns === 1,
          max_runs: job.maxRuns,
          run_count: job.runCount,
          next_run_at: job.nextRunAt,
          message: metadata.message,
          agent_id: metadata.agentId,
          routing: metadata.routing
        };
      });

      trace("tool:cron_list_jobs", "listed", {
        count: jobs.length
      });

      return {
        ok: true,
        count: jobs.length,
        jobs
      };
    }
  };
}

function summarizeCronJobMetadata(
  metadata: Record<string, unknown>
): CronJobMetadataSummary {
  const routing =
    typeof metadata.routing === "object" && metadata.routing !== null
      ? (metadata.routing as Record<string, unknown>)
      : {};

  return {
    message: toNonEmptyStringOrNull(metadata.message),
    agentId: toNonEmptyStringOrNull(metadata.agentId),
    routing: {
      thread_id: toNonEmptyStringOrNull(routing.threadId),
      subject_type: toNonEmptyStringOrNull(routing.subjectType),
      subject_id: toNonEmptyStringOrNull(routing.subjectId),
      allow_unbound_thread: routing.allowUnboundThread === true
    }
  };
}

function toNonEmptyStringOrNull(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
