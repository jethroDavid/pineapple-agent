import { z } from "zod";

import { jsonObjectSchema } from "../../shared/types/json.js";

const triggerInputItemSchema = jsonObjectSchema;
const triggerInputSchema = z.union([
  z.string().min(1),
  z.array(triggerInputItemSchema).min(1)
]);

const triggerPromptSchema = z.object({
  input: triggerInputSchema,
  instructions: z.string().min(1).optional(),
  agent_id: z.string().min(1).optional()
});

export type TriggerPrompt = z.infer<typeof triggerPromptSchema>;

export function parseTriggerPrompt(payload: unknown): TriggerPrompt {
  return triggerPromptSchema.parse(payload);
}
