import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core";

import type { ThreadMetadata } from "../threads/domain/thread.js";
import type { SpecialistSession } from "../agents/domain/specialist-session.js";
import {
  agentExecutionDecisionStatuses
} from "../execution/domain/agent-execution-decision.js";
import {
  activeAgentExecutionStatuses,
  agentExecutionKinds,
  agentExecutionStatuses,
  type AgentExecutionCheckpoint
} from "../execution/domain/agent-execution.js";
import type { JsonObject } from "../shared/types/json.js";

const agentExecutionKindEnum = pgEnum("agent_execution_kind", agentExecutionKinds);
const agentExecutionStatusEnum = pgEnum("agent_execution_status", agentExecutionStatuses);
const agentExecutionDecisionStatusEnum = pgEnum(
  "agent_execution_decision_status",
  agentExecutionDecisionStatuses
);

export const threads = pgTable(
  "threads",
  {
    threadId: uuid("thread_id").primaryKey(),
    subjectType: text("subject_type"),
    subjectId: text("subject_id"),
    title: text("title"),
    description: text("description"),
    threadMetadata: jsonb("thread_metadata")
      .$type<ThreadMetadata>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    lastResponseId: text("last_response_id"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
  },
  (table) => [
    check(
      "threads_subject_pair_chk",
      sql`(
        (${table.subjectType} is null and ${table.subjectId} is null)
        or
        (${table.subjectType} is not null and ${table.subjectId} is not null)
      )`
    ),
    uniqueIndex("threads_active_subject_unique_idx")
      .on(table.subjectType, table.subjectId)
      .where(
        sql`${table.closedAt} is null and ${table.subjectType} is not null and ${table.subjectId} is not null`
      )
  ]
);

export const agentThreads = pgTable("agent_threads", {
  threadId: uuid("thread_id")
    .primaryKey()
    .references(() => threads.threadId),
  entrypointAgentId: text("entrypoint_agent_id").notNull(),
  activeAgentId: text("active_agent_id").notNull(),
  sessionItems: jsonb("session_items").$type<unknown[]>().notNull().default(sql`'[]'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
});

export const specialistSessions = pgTable(
  "specialist_sessions",
  {
    specialistSessionId: uuid("specialist_session_id").primaryKey(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => threads.threadId),
    agentId: text("agent_id").notNull(),
    provider: text("provider").notNull(),
    providerThreadId: text("provider_thread_id"),
    state: jsonb("state").$type<SpecialistSession["state"]>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
  },
  (table) => [
    uniqueIndex("specialist_sessions_thread_agent_unique_idx").on(table.threadId, table.agentId)
  ]
);

export const agentExecutions = pgTable(
  "agent_executions",
  {
    executionId: uuid("execution_id").primaryKey(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => threads.threadId),
    kind: agentExecutionKindEnum("kind").notNull(),
    status: agentExecutionStatusEnum("status").notNull(),
    triggerId: text("trigger_id"),
    entrypointAgentId: text("entrypoint_agent_id").notNull(),
    requestedAgentId: text("requested_agent_id"),
    activeAgentId: text("active_agent_id").notNull(),
    checkpoint: jsonb("checkpoint")
      .$type<AgentExecutionCheckpoint>()
      .notNull()
      .default(
        sql`'{"inputItems":[],"routeKind":null,"runState":null}'::jsonb`
      ),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
  },
  (table) => [
    uniqueIndex("agent_executions_trigger_id_unique_idx")
      .on(table.triggerId)
      .where(sql`${table.triggerId} is not null`),
    uniqueIndex("agent_executions_active_thread_unique_idx")
      .on(table.threadId)
      .where(
        sql`${table.status} in ${sql.raw(`('${activeAgentExecutionStatuses.join("','")}')`)}`
      ),
    index("agent_executions_status_created_idx").on(table.status, table.createdAt)
  ]
);

export const agentExecutionDecisions = pgTable(
  "agent_execution_decisions",
  {
    decisionId: uuid("decision_id").primaryKey(),
    executionId: uuid("execution_id")
      .notNull()
      .references(() => agentExecutions.executionId),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => threads.threadId),
    status: agentExecutionDecisionStatusEnum("status").notNull(),
    reasonCode: text("reason_code").notNull(),
    agentId: text("agent_id").notNull(),
    toolName: text("tool_name").notNull(),
    toolCallId: text("tool_call_id").notNull(),
    toolArguments: jsonb("tool_arguments").$type<JsonObject>().notNull(),
    requestedAction: jsonb("requested_action").$type<JsonObject>().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    resolvedByActor: text("resolved_by_actor"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull()
  },
  (table) => [
    uniqueIndex("agent_execution_decisions_pending_execution_unique_idx")
      .on(table.executionId)
      .where(sql`${table.status} = 'pending'`)
  ]
);
