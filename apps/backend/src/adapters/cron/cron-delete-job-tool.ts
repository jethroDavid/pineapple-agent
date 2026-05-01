import { z } from "zod";

import type { ToolDefinition } from "../../tools/tool-definition.js";
import { trace } from "../../utils/trace.js";
import type { CronScheduler } from "./cron-scheduler.js";

const cronDeleteJobInputSchema = z.object({
  job_id: z.string().min(1)
});

const cronDeleteJobOutputSchema = z.object({
  ok: z.literal(true),
  job_id: z.string().min(1),
  deleted: z.boolean()
});

type CronDeleteJobInput = z.infer<typeof cronDeleteJobInputSchema>;
type CronDeleteJobOutput = z.infer<typeof cronDeleteJobOutputSchema>;

export function createCronDeleteJobTool(options: {
  scheduler: CronScheduler;
}): ToolDefinition<CronDeleteJobInput, CronDeleteJobOutput> {
  return {
    name: "cron_delete_job",
    description:
      "Delete an active cron job/reminder by job ID. Use cron_list_jobs first when you need to find the job ID.",
    inputSchema: cronDeleteJobInputSchema,
    outputSchema: cronDeleteJobOutputSchema,
    sideEffecting: true,
    approvalRequired: false,
    idempotent: true,
    async execute(input) {
      const deleted = await options.scheduler.removeJob(input.job_id);

      trace("tool:cron_delete_job", "deleted", {
        jobId: input.job_id,
        deleted
      });

      return {
        ok: true,
        job_id: input.job_id,
        deleted
      };
    }
  };
}
