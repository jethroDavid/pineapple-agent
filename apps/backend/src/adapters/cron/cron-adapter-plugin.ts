import { env } from "../../config/env.js";
import type { AdapterPlugin } from "../adapter-plugin.js";
import { resolveAdapterEnabled } from "../adapter-enabled.js";
import { createCronAdapter } from "./cron-adapter.js";
import { DrizzleCronJobStore } from "./cron-drizzle-job-store.js";
import type { CronJobStore } from "./cron-job-store.js";

export interface CronAdapterDependencies {
  jobStore?: CronJobStore;
}

export const cronAdapterPlugin: AdapterPlugin = {
  id: "cron",
  startupOrder: 150,
  create(context) {
    const dependencies = resolveCronAdapterDependencies(context.dependencies);
    const jobsJson = env.CRON_JOBS_JSON ?? null;
    const hasJobsJson = (jobsJson?.trim() ?? "").length > 0;
    const enabled = resolveAdapterEnabled({
      explicit: env.CRON_ENABLED,
      hasConfig: hasJobsJson
    });

    return createCronAdapter({
      enabled,
      jobsJson,
      jobStore:
        enabled
          ? dependencies.jobStore ?? new DrizzleCronJobStore()
          : dependencies.jobStore
    });
  }
};

function resolveCronAdapterDependencies(value: unknown): CronAdapterDependencies {
  if (value === undefined) {
    return {};
  }

  if (!isRecord(value)) {
    throw new Error("Cron adapter plugin dependencies must be an object.");
  }

  return {
    jobStore: value.jobStore as CronJobStore | undefined
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
