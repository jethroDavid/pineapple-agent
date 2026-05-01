CREATE TABLE "cron_jobs" (
	"job_id" text PRIMARY KEY NOT NULL,
	"expression" text NOT NULL,
	"max_runs" integer,
	"run_count" integer DEFAULT 0 NOT NULL,
	"next_run_at" timestamp with time zone NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "cron_jobs_max_runs_positive_chk" CHECK ("cron_jobs"."max_runs" is null or "cron_jobs"."max_runs" > 0),
	CONSTRAINT "cron_jobs_run_count_nonnegative_chk" CHECK ("cron_jobs"."run_count" >= 0)
);
--> statement-breakpoint
CREATE INDEX "cron_jobs_active_next_run_idx" ON "cron_jobs" USING btree ("next_run_at") WHERE "cron_jobs"."deleted_at" is null;
