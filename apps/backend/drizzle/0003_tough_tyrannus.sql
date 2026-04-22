CREATE TABLE "agent_threads" (
	"thread_id" uuid PRIMARY KEY NOT NULL,
	"entrypoint_agent_id" text NOT NULL,
	"active_agent_id" text NOT NULL,
	"last_response_id" text,
	"session_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"checkpoint" jsonb DEFAULT '{"runState":null}'::jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "specialist_sessions" (
	"specialist_session_id" uuid PRIMARY KEY NOT NULL,
	"thread_id" uuid NOT NULL,
	"agent_id" text NOT NULL,
	"provider" text NOT NULL,
	"provider_thread_id" text,
	"state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_threads" ADD CONSTRAINT "agent_threads_thread_id_threads_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("thread_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "specialist_sessions" ADD CONSTRAINT "specialist_sessions_thread_id_threads_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("thread_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "specialist_sessions_thread_agent_unique_idx" ON "specialist_sessions" USING btree ("thread_id","agent_id");--> statement-breakpoint
