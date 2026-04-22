ALTER TABLE "human_decisions" ADD CONSTRAINT "human_decisions_thread_id_threads_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("thread_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "human_decisions" ADD CONSTRAINT "human_decisions_run_id_runs_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("run_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_thread_id_threads_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("thread_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "human_decisions_pending_run_unique_idx" ON "human_decisions" USING btree ("run_id") WHERE "human_decisions"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "runs_trigger_id_unique_idx" ON "runs" USING btree ("trigger_id");--> statement-breakpoint
CREATE UNIQUE INDEX "runs_active_thread_unique_idx" ON "runs" USING btree ("thread_id") WHERE "runs"."status" in ('queued','running','awaiting_approval');--> statement-breakpoint
CREATE INDEX "runs_queue_lookup_idx" ON "runs" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "threads_active_subject_unique_idx" ON "threads" USING btree ("subject_type","subject_id") WHERE "threads"."closed_at" is null and "threads"."subject_type" is not null and "threads"."subject_id" is not null;--> statement-breakpoint
ALTER TABLE "threads" ADD CONSTRAINT "threads_subject_pair_chk" CHECK ((
        ("threads"."subject_type" is null and "threads"."subject_id" is null)
        or
        ("threads"."subject_type" is not null and "threads"."subject_id" is not null)
      ));