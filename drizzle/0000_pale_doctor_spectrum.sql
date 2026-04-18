CREATE TYPE "public"."human_decision_status" AS ENUM('pending', 'approved', 'rejected', 'expired');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('queued', 'running', 'awaiting_approval', 'completed', 'failed', 'canceled');--> statement-breakpoint
CREATE TABLE "human_decisions" (
	"decision_id" uuid PRIMARY KEY NOT NULL,
	"thread_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"status" "human_decision_status" NOT NULL,
	"reason_code" text NOT NULL,
	"requested_action" jsonb NOT NULL,
	"expires_at" timestamp with time zone,
	"resolved_by_actor" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"run_id" uuid PRIMARY KEY NOT NULL,
	"thread_id" uuid NOT NULL,
	"trigger_id" text NOT NULL,
	"status" "run_status" NOT NULL,
	"checkpoint" jsonb NOT NULL,
	"error_code" text,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "threads" (
	"thread_id" uuid PRIMARY KEY NOT NULL,
	"subject_type" text,
	"subject_id" text,
	"last_response_id" text,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
