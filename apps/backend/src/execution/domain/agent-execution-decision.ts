import { z } from "zod";

import { jsonObjectSchema } from "../../shared/types/json.js";

export const agentExecutionDecisionStatus = {
  pending: "pending",
  approved: "approved",
  rejected: "rejected",
  expired: "expired"
} as const;

export const agentExecutionDecisionStatuses = [
  agentExecutionDecisionStatus.pending,
  agentExecutionDecisionStatus.approved,
  agentExecutionDecisionStatus.rejected,
  agentExecutionDecisionStatus.expired
] as const;

const agentExecutionDecisionSchema = z
  .object({
    decisionId: z.uuid(),
    executionId: z.uuid(),
    threadId: z.uuid(),
    status: z.enum(agentExecutionDecisionStatuses),
    reasonCode: z.string().min(1),
    agentId: z.string().min(1),
    toolName: z.string().min(1),
    toolCallId: z.string().min(1),
    toolArguments: jsonObjectSchema,
    requestedAction: jsonObjectSchema,
    expiresAt: z.date().nullable(),
    resolvedByActor: z.string().min(1).nullable(),
    resolvedAt: z.date().nullable(),
    createdAt: z.date()
  })
  .superRefine((decision, ctx) => {
    if (decision.status === agentExecutionDecisionStatus.pending) {
      if (decision.resolvedAt !== null || decision.resolvedByActor !== null) {
        ctx.addIssue({
          code: "custom",
          message: "Pending execution decisions cannot have resolution fields."
        });
      }
      return;
    }

    if (decision.resolvedAt === null) {
      ctx.addIssue({
        code: "custom",
        message: "Resolved execution decisions must include resolvedAt."
      });
    }

    if (
      (decision.status === agentExecutionDecisionStatus.approved ||
        decision.status === agentExecutionDecisionStatus.rejected) &&
      decision.resolvedByActor === null
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Approved and rejected execution decisions must include resolvedByActor."
      });
    }
  });

const newAgentExecutionDecisionSchema = z.object({
  executionId: z.uuid(),
  threadId: z.uuid(),
  reasonCode: z.string().min(1),
  agentId: z.string().min(1),
  toolName: z.string().min(1),
  toolCallId: z.string().min(1),
  toolArguments: jsonObjectSchema,
  requestedAction: jsonObjectSchema,
  expiresAt: z.date().nullable().optional()
});

export const agentExecutionDecisionResolutionSchema = z.union([
  z.object({
    status: z.literal(agentExecutionDecisionStatus.approved),
    resolvedByActor: z.string().min(1),
    resolvedAt: z.date().optional()
  }),
  z.object({
    status: z.literal(agentExecutionDecisionStatus.rejected),
    resolvedByActor: z.string().min(1),
    resolvedAt: z.date().optional()
  }),
  z.object({
    status: z.literal(agentExecutionDecisionStatus.expired),
    resolvedAt: z.date().optional()
  })
]);

export type AgentExecutionDecision = z.infer<typeof agentExecutionDecisionSchema>;
export type NewAgentExecutionDecision = z.input<typeof newAgentExecutionDecisionSchema>;
export type AgentExecutionDecisionResolution = z.infer<
  typeof agentExecutionDecisionResolutionSchema
>;

export class AgentExecutionDecisionResolutionError extends Error {}

export function createAgentExecutionDecision(
  input: NewAgentExecutionDecision
): AgentExecutionDecision {
  const now = new Date();
  const parsed = newAgentExecutionDecisionSchema.parse(input);

  return agentExecutionDecisionSchema.parse({
    decisionId: crypto.randomUUID(),
    executionId: parsed.executionId,
    threadId: parsed.threadId,
    status: agentExecutionDecisionStatus.pending,
    reasonCode: parsed.reasonCode,
    agentId: parsed.agentId,
    toolName: parsed.toolName,
    toolCallId: parsed.toolCallId,
    toolArguments: parsed.toolArguments,
    requestedAction: parsed.requestedAction,
    expiresAt: parsed.expiresAt ?? null,
    resolvedByActor: null,
    resolvedAt: null,
    createdAt: now
  });
}

export function restoreAgentExecutionDecision(
  input: AgentExecutionDecision
): AgentExecutionDecision {
  return agentExecutionDecisionSchema.parse(input);
}

export function resolveAgentExecutionDecision(
  decision: AgentExecutionDecision,
  resolution: AgentExecutionDecisionResolution
): AgentExecutionDecision {
  if (decision.status !== agentExecutionDecisionStatus.pending) {
    throw new AgentExecutionDecisionResolutionError(
      `Only pending execution decisions can be resolved. Received ${decision.status}.`
    );
  }

  const resolvedAt = resolution.resolvedAt ?? new Date();

  if (resolution.status === agentExecutionDecisionStatus.expired) {
    return agentExecutionDecisionSchema.parse({
      ...decision,
      status: resolution.status,
      resolvedAt,
      resolvedByActor: null
    });
  }

  return agentExecutionDecisionSchema.parse({
    ...decision,
    status: resolution.status,
    resolvedAt,
    resolvedByActor: resolution.resolvedByActor
  });
}
