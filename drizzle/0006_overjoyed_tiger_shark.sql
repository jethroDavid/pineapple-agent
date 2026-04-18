ALTER TABLE "agent_executions" ALTER COLUMN "checkpoint" SET DEFAULT '{"inputItems":[],"routeKind":null,"runState":null}'::jsonb;
--> statement-breakpoint
ALTER TABLE "agent_threads" DROP COLUMN "last_response_id";
--> statement-breakpoint
ALTER TABLE "agent_threads" DROP COLUMN "checkpoint";
