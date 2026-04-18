import { z } from "zod";

import { jsonObjectSchema } from "../../shared/types/json.js";

const specialistSessionSchema = z.object({
  specialistSessionId: z.uuid(),
  threadId: z.uuid(),
  agentId: z.string().min(1),
  provider: z.string().min(1),
  providerThreadId: z.string().min(1).nullable(),
  state: jsonObjectSchema,
  createdAt: z.date(),
  updatedAt: z.date()
});

const newSpecialistSessionSchema = z.object({
  threadId: z.uuid(),
  agentId: z.string().min(1),
  provider: z.string().min(1),
  providerThreadId: z.string().min(1).nullable().optional(),
  state: jsonObjectSchema.optional()
});

export type SpecialistSession = z.infer<typeof specialistSessionSchema>;
type NewSpecialistSession = z.input<typeof newSpecialistSessionSchema>;

export function createSpecialistSession(input: NewSpecialistSession): SpecialistSession {
  const now = new Date();
  const parsed = newSpecialistSessionSchema.parse(input);

  return specialistSessionSchema.parse({
    specialistSessionId: crypto.randomUUID(),
    threadId: parsed.threadId,
    agentId: parsed.agentId,
    provider: parsed.provider,
    providerThreadId: parsed.providerThreadId ?? null,
    state: parsed.state ?? {},
    createdAt: now,
    updatedAt: now
  });
}

export function restoreSpecialistSession(input: SpecialistSession): SpecialistSession {
  return specialistSessionSchema.parse(input);
}
