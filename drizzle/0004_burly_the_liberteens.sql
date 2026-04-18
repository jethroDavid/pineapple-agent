CREATE TYPE "public"."agent_execution_decision_status" AS ENUM('pending', 'approved', 'rejected', 'expired');--> statement-breakpoint
CREATE TYPE "public"."agent_execution_kind" AS ENUM('trigger', 'manual_turn', 'decision_resolution', 'recovery');--> statement-breakpoint
CREATE TYPE "public"."agent_execution_status" AS ENUM('queued', 'running', 'awaiting_approval', 'completed', 'failed', 'canceled');--> statement-breakpoint
CREATE TABLE "agent_execution_decisions" (
	"decision_id" uuid PRIMARY KEY NOT NULL,
	"execution_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"status" "agent_execution_decision_status" NOT NULL,
	"reason_code" text NOT NULL,
	"agent_id" text NOT NULL,
	"tool_name" text NOT NULL,
	"tool_call_id" text NOT NULL,
	"tool_arguments" jsonb NOT NULL,
	"requested_action" jsonb NOT NULL,
	"expires_at" timestamp with time zone,
	"resolved_by_actor" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_executions" (
	"execution_id" uuid PRIMARY KEY NOT NULL,
	"thread_id" uuid NOT NULL,
	"kind" "agent_execution_kind" NOT NULL,
	"status" "agent_execution_status" NOT NULL,
	"trigger_id" text,
	"entrypoint_agent_id" text NOT NULL,
	"requested_agent_id" text,
	"active_agent_id" text NOT NULL,
	"checkpoint" jsonb DEFAULT '{"inputText":null,"inputItems":[],"routeKind":null,"runState":null,"pendingDecisionId":null}'::jsonb NOT NULL,
	"error_code" text,
	"error_message" text,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_execution_decisions" ADD CONSTRAINT "agent_execution_decisions_execution_id_agent_executions_execution_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."agent_executions"("execution_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_execution_decisions" ADD CONSTRAINT "agent_execution_decisions_thread_id_threads_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("thread_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_executions" ADD CONSTRAINT "agent_executions_thread_id_threads_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("thread_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_execution_decisions_pending_execution_unique_idx" ON "agent_execution_decisions" USING btree ("execution_id") WHERE "agent_execution_decisions"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "agent_executions_trigger_id_unique_idx" ON "agent_executions" USING btree ("trigger_id") WHERE "agent_executions"."trigger_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_executions_active_thread_unique_idx" ON "agent_executions" USING btree ("thread_id") WHERE "agent_executions"."status" in ('queued','running','awaiting_approval');--> statement-breakpoint
CREATE INDEX "agent_executions_status_created_idx" ON "agent_executions" USING btree ("status","created_at");