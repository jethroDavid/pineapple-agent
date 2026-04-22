ALTER TABLE "threads" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "thread_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;
