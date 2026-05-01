import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp
} from "drizzle-orm/pg-core";

export type CronJobMetadata = Record<string, unknown>;

export const cronJobs = pgTable(
  "cron_jobs",
  {
    jobId: text("job_id").primaryKey(),
    expression: text("expression").notNull(),
    maxRuns: integer("max_runs"),
    runCount: integer("run_count").notNull().default(0),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }).notNull(),
    metadata: jsonb("metadata")
      .$type<CronJobMetadata>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
  },
  (table) => [
    check(
      "cron_jobs_max_runs_positive_chk",
      sql`${table.maxRuns} is null or ${table.maxRuns} > 0`
    ),
    check("cron_jobs_run_count_nonnegative_chk", sql`${table.runCount} >= 0`),
    index("cron_jobs_active_next_run_idx")
      .on(table.nextRunAt)
      .where(sql`${table.deletedAt} is null`)
  ]
);
