import type { Thread } from "../../threads/domain/thread.js";
import type { TriggerPrompt } from "../contracts/trigger-prompt.js";
import type { TriggerEvent } from "../contracts/trigger-event.js";

export type TriggerPromptEnricher = (input: {
  triggerEvent: TriggerEvent;
  thread: Thread;
  prompt: TriggerPrompt;
}) => TriggerPrompt;

export function enrichTriggerPrompt(input: {
  triggerEvent: TriggerEvent;
  thread: Thread;
  prompt: TriggerPrompt;
  enrichers?: readonly TriggerPromptEnricher[];
}): TriggerPrompt {
  let prompt = input.prompt;

  for (const enricher of input.enrichers ?? []) {
    prompt = enricher({
      triggerEvent: input.triggerEvent,
      thread: input.thread,
      prompt
    });
  }

  return prompt;
}

export function appendTriggerPromptInstruction(
  existingInstructions: string | undefined,
  nextInstruction: string
): string {
  const trimmedInstruction = nextInstruction.trim();

  if (!existingInstructions || existingInstructions.trim().length === 0) {
    return trimmedInstruction;
  }

  if (existingInstructions.includes(trimmedInstruction)) {
    return existingInstructions;
  }

  return `${existingInstructions} ${trimmedInstruction}`;
}
