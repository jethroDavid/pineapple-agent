import { env } from "../../config/env.js";
import type { AdapterPlugin } from "../adapter-plugin.js";
import { createCronAdapter } from "./cron-adapter.js";

export const cronAdapterPlugin: AdapterPlugin = {
  id: "cron",
  startupOrder: 150,
  create() {
    return createCronAdapter({
      enabled: env.CRON_ENABLED ?? true,
      jobsJson: env.CRON_JOBS_JSON ?? null
    });
  }
};
