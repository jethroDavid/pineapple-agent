import type { AgentInputItem } from "@openai/agents";
import { z } from "zod";

const sessionItemsSchema = z.array(z.unknown()).transform((value) => value as AgentInputItem[]);

const agentThreadSchema = z.object({
  threadId: z.uuid(),
  entrypointAgentId: z.string().min(1),
  activeAgentId: z.string().min(1),
  sessionItems: sessionItemsSchema,
  createdAt: z.date(),
  updatedAt: z.date()
});

const newAgentThreadSchema = z.object({
  threadId: z.uuid(),
  entrypointAgentId: z.string().min(1),
  activeAgentId: z.string().min(1).optional()
});

export type AgentThread = z.infer<typeof agentThreadSchema>;
export type NewAgentThread = z.input<typeof newAgentThreadSchema>;

export function createAgentThread(input: NewAgentThread): AgentThread {
  const now = new Date();
  const parsed = newAgentThreadSchema.parse(input);

  return agentThreadSchema.parse({
    threadId: parsed.threadId,
    entrypointAgentId: parsed.entrypointAgentId,
    activeAgentId: parsed.activeAgentId ?? parsed.entrypointAgentId,
    sessionItems: [],
    createdAt: now,
    updatedAt: now
  });
}

export function restoreAgentThread(input: AgentThread): AgentThread {
  return agentThreadSchema.parse(input);
}

export function replaceAgentThreadSessionItems(
  agentThread: AgentThread,
  sessionItems: AgentInputItem[],
  updatedAt: Date = new Date()
): AgentThread {
  return agentThreadSchema.parse({
    ...agentThread,
    sessionItems,
    updatedAt
  });
}

export function updateAgentThreadState(
  agentThread: AgentThread,
  patch: {
    activeAgentId?: string;
  },
  updatedAt: Date = new Date()
): AgentThread {
  return agentThreadSchema.parse({
    ...agentThread,
    ...(patch.activeAgentId === undefined
      ? {}
      : {
          activeAgentId: patch.activeAgentId
        }),
    updatedAt
  });
}
