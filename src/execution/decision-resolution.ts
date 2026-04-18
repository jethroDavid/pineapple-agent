import { z } from "zod";

import {
  agentExecutionDecisionResolutionSchema,
  agentExecutionDecisionStatus,
  type AgentExecutionDecisionResolution
} from "./domain/agent-execution-decision.js";

const executionDecisionResolutionRequestSchema = z.union([
  z.object({
    status: z.literal(agentExecutionDecisionStatus.approved),
    resolved_by_actor: z.string().min(1),
    resolved_at: z.iso.datetime().optional()
  }),
  z.object({
    status: z.literal(agentExecutionDecisionStatus.rejected),
    resolved_by_actor: z.string().min(1),
    resolved_at: z.iso.datetime().optional()
  }),
  z.object({
    status: z.literal(agentExecutionDecisionStatus.expired),
    resolved_at: z.iso.datetime().optional()
  })
]);

type ExecutionDecisionResolutionRequest = z.input<
  typeof executionDecisionResolutionRequestSchema
>;

export function parseDecisionResolutionRequest(
  input: ExecutionDecisionResolutionRequest
): AgentExecutionDecisionResolution {
  const parsed = executionDecisionResolutionRequestSchema.parse(input);

  if (parsed.status === agentExecutionDecisionStatus.expired) {
    return agentExecutionDecisionResolutionSchema.parse({
      status: parsed.status,
      resolvedAt: parsed.resolved_at ? new Date(parsed.resolved_at) : undefined
    });
  }

  return agentExecutionDecisionResolutionSchema.parse({
    status: parsed.status,
    resolvedByActor: parsed.resolved_by_actor,
    resolvedAt: parsed.resolved_at ? new Date(parsed.resolved_at) : undefined
  });
}
