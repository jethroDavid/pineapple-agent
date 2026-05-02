import type { TriggerPromptEnricher } from "../../execution/pipeline/trigger-prompt-enrichment.js";
import { appendTriggerPromptInstruction } from "../../execution/pipeline/trigger-prompt-enrichment.js";
import { trace } from "../../utils/trace.js";

export const telegramThreadContextPromptEnricher: TriggerPromptEnricher = ({
  triggerEvent,
  thread,
  prompt
}) => {
  if (triggerEvent.source.system !== "telegram") {
    return prompt;
  }

  if (thread.subjectType !== "shortcut_story" || thread.subjectId === null) {
    return prompt;
  }

  const instructions = appendTriggerPromptInstruction(
    prompt.instructions,
    [
      `Thread context: this Telegram message is attached to Shortcut story ${thread.subjectId}.`,
      `For requests that update, comment on, or refer to this story, use story_public_id=${thread.subjectId} with Shortcut tools.`,
      "Do not claim Shortcut changes were made unless a Shortcut tool succeeds."
    ].join(" ")
  );

  if (instructions === prompt.instructions) {
    return prompt;
  }

  trace("telegram", "thread context prompt enriched", {
    triggerId: triggerEvent.trigger_id,
    threadId: thread.threadId,
    subjectType: thread.subjectType,
    subjectId: thread.subjectId
  });

  return {
    ...prompt,
    instructions
  };
};

export const telegramReminderTriggerPromptEnricher: TriggerPromptEnricher = ({
  triggerEvent,
  thread,
  prompt
}) => {
  if (
    triggerEvent.source.system !== "pineapple-cron" ||
    triggerEvent.source.event_type !== "reminder.tick"
  ) {
    return prompt;
  }

  const telegramContext = thread.threadMetadata.deliveryContext.telegram;

  if (telegramContext === null) {
    return prompt;
  }

  const chatTypeSuffix = telegramContext.chatType
    ? ` (chat_type=${telegramContext.chatType})`
    : "";
  const instructions = appendTriggerPromptInstruction(
    prompt.instructions,
    [
      `Delivery context: this reminder belongs to Telegram chat_id=${telegramContext.chatId}${chatTypeSuffix}.`,
      "Call telegram_send_message using this exact chat_id."
    ].join(" ")
  );

  if (instructions === prompt.instructions) {
    return prompt;
  }

  trace("telegram", "trigger prompt enriched", {
    triggerId: triggerEvent.trigger_id,
    threadId: thread.threadId,
    chatId: telegramContext.chatId
  });

  return {
    ...prompt,
    instructions
  };
};
