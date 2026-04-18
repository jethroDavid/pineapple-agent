import type { AgentInputItem } from "@openai/agents";
import { z } from "zod";

const executionInputItemsSchema = z.array(z.unknown()).transform((value) => value as AgentInputItem[]);

export const agentExecutionKind = {
  trigger: "trigger",
  manualTurn: "manual_turn",
  decisionResolution: "decision_resolution",
  recovery: "recovery"
} as const;

export const agentExecutionKinds = [
  agentExecutionKind.trigger,
  agentExecutionKind.manualTurn,
  agentExecutionKind.decisionResolution,
  agentExecutionKind.recovery
] as const;

export const agentExecutionStatus = {
  queued: "queued",
  running: "running",
  awaitingApproval: "awaiting_approval",
  completed: "completed",
  failed: "failed",
  canceled: "canceled"
} as const;

export const agentExecutionStatuses = [
  agentExecutionStatus.queued,
  agentExecutionStatus.running,
  agentExecutionStatus.awaitingApproval,
  agentExecutionStatus.completed,
  agentExecutionStatus.failed,
  agentExecutionStatus.canceled
] as const;

export const activeAgentExecutionStatuses = [
  agentExecutionStatus.queued,
  agentExecutionStatus.running,
  agentExecutionStatus.awaitingApproval
] as const;

export type AgentExecutionStatus = (typeof agentExecutionStatuses)[number];

const agentExecutionCheckpointSchema = z.object({
  inputItems: executionInputItemsSchema.default([]),
  routeKind: z.string().min(1).nullable().default(null),
  runState: z.string().min(1).nullable().default(null)
});

const agentExecutionSchema = z.object({
  executionId: z.uuid(),
  threadId: z.uuid(),
  kind: z.enum(agentExecutionKinds),
  status: z.enum(agentExecutionStatuses),
  triggerId: z.string().min(1).nullable(),
  entrypointAgentId: z.string().min(1),
  requestedAgentId: z.string().min(1).nullable(),
  activeAgentId: z.string().min(1),
  checkpoint: agentExecutionCheckpointSchema,
  errorCode: z.string().min(1).nullable(),
  errorMessage: z.string().min(1).nullable(),
  startedAt: z.date().nullable(),
  endedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date()
});

const newAgentExecutionSchema = z.object({
  threadId: z.uuid(),
  kind: z.enum(agentExecutionKinds),
  triggerId: z.string().min(1).nullable().optional(),
  entrypointAgentId: z.string().min(1),
  requestedAgentId: z.string().min(1).nullable().optional(),
  activeAgentId: z.string().min(1),
  checkpoint: agentExecutionCheckpointSchema
});

export type AgentExecution = z.infer<typeof agentExecutionSchema>;
export type AgentExecutionCheckpoint = z.infer<typeof agentExecutionCheckpointSchema>;
export type NewAgentExecution = z.input<typeof newAgentExecutionSchema>;

export function createAgentExecution(input: NewAgentExecution): AgentExecution {
  const now = new Date();
  const parsed = newAgentExecutionSchema.parse(input);

  return agentExecutionSchema.parse({
    executionId: crypto.randomUUID(),
    threadId: parsed.threadId,
    kind: parsed.kind,
    status: agentExecutionStatus.queued,
    triggerId: parsed.triggerId ?? null,
    entrypointAgentId: parsed.entrypointAgentId,
    requestedAgentId: parsed.requestedAgentId ?? null,
    activeAgentId: parsed.activeAgentId,
    checkpoint: parsed.checkpoint,
    errorCode: null,
    errorMessage: null,
    startedAt: null,
    endedAt: null,
    createdAt: now,
    updatedAt: now
  });
}

export function restoreAgentExecution(input: AgentExecution): AgentExecution {
  return agentExecutionSchema.parse(input);
}
