import {
  createTriggerEvent,
  triggerActorType,
  triggerSourceKind,
  type TriggerEvent
} from "../../execution/contracts/trigger-event.js";
import type { CronJobDefinition } from "./cron-scheduler.js";

export interface CronReminderRouting {
  threadId?: string;
  subjectType?: string;
  subjectId?: string;
  allowUnboundThread: boolean;
}

export interface CronReminderJobMetadata extends Record<string, unknown> {
  message: string;
  instructions?: string;
  agentId?: string;
  routing: CronReminderRouting;
}

export interface CreateCronReminderJobOptions {
  id: string;
  expression: string;
  message: string;
  instructions?: string;
  agentId?: string;
  routing: CronReminderRouting;
  maxRuns?: number;
}

export function createCronReminderJobDefinition(
  options: CreateCronReminderJobOptions
): CronJobDefinition {
  return {
    id: options.id,
    expression: options.expression,
    maxRuns: options.maxRuns,
    metadata: {
      message: options.message,
      instructions: options.instructions,
      agentId: options.agentId,
      routing: options.routing
    } satisfies CronReminderJobMetadata
  };
}

export function createCronReminderTriggerEvent(
  job: CronJobDefinition,
  scheduledAt: Date
): TriggerEvent {
  const metadata = parseCronReminderJobMetadata(job.metadata);
  const defaultInstructions = [
    "This is a scheduled reminder fired by Pineapple cron.",
    "Deliver the reminder proactively using an available channel tool for this thread.",
    "Reuse any delivery context already stored on the thread.",
    "Do not ask the user for channel identifiers when they already exist in context.",
    "Do not only return plain text when a delivery tool is available."
  ].join(" ");

  return createTriggerEvent({
    trigger_id: `cron:${job.id}:${scheduledAt.toISOString()}`,
    source: {
      kind: triggerSourceKind.system,
      system: "pineapple-cron",
      event_type: "reminder.tick"
    },
    actor: {
      type: triggerActorType.system,
      id: "pineapple-cron"
    },
    routing: toTriggerRouting(metadata.routing),
    payload: {
      input: [
        "Scheduled reminder",
        `Reminder: ${metadata.message}`,
        `Scheduled at: ${scheduledAt.toISOString()}`
      ].join("\n"),
      instructions: mergeReminderInstructions(defaultInstructions, metadata.instructions),
      agent_id: metadata.agentId
    },
    received_at: scheduledAt.toISOString()
  });
}

export function createOneShotCronExpression(runAt: Date): string {
  return [
    runAt.getSeconds(),
    runAt.getMinutes(),
    runAt.getHours(),
    runAt.getDate(),
    runAt.getMonth() + 1,
    "*"
  ].join(" ");
}

export function resolveCronReminderRouting(options: {
  contextThreadId?: string;
  threadId?: string;
  subjectType?: string;
  subjectId?: string;
  allowUnboundThread?: boolean;
}): CronReminderRouting {
  const threadId = options.threadId?.trim() || undefined;
  const subjectType = options.subjectType?.trim() || undefined;
  const subjectId = options.subjectId?.trim() || undefined;

  if ((subjectType === undefined) !== (subjectId === undefined)) {
    throw new Error("subject_type and subject_id must be provided together.");
  }

  if (threadId !== undefined) {
    return {
      threadId,
      allowUnboundThread: false
    };
  }

  if (subjectType !== undefined && subjectId !== undefined) {
    return {
      subjectType,
      subjectId,
      allowUnboundThread: false
    };
  }

  if (options.allowUnboundThread === true) {
    return {
      allowUnboundThread: true
    };
  }

  if (options.contextThreadId !== undefined) {
    return {
      threadId: options.contextThreadId,
      allowUnboundThread: false
    };
  }

  return {
    allowUnboundThread: true
  };
}

function parseCronReminderJobMetadata(value: Record<string, unknown>): CronReminderJobMetadata {
  const message = typeof value.message === "string" ? value.message : null;
  const instructions = typeof value.instructions === "string" ? value.instructions : undefined;
  const agentId = typeof value.agentId === "string" ? value.agentId : undefined;
  const routing =
    typeof value.routing === "object" && value.routing !== null
      ? (value.routing as Partial<CronReminderRouting>)
      : null;

  if (message === null || message.trim().length === 0) {
    throw new Error("Cron reminder metadata is missing a valid message.");
  }

  if (routing === null) {
    throw new Error("Cron reminder metadata is missing routing information.");
  }

  return {
    message,
    instructions,
    agentId,
    routing: {
      threadId: routing.threadId,
      subjectType: routing.subjectType,
      subjectId: routing.subjectId,
      allowUnboundThread: routing.allowUnboundThread === true
    }
  };
}

function toTriggerRouting(routing: CronReminderRouting): TriggerEvent["routing"] {
  if (routing.threadId !== undefined) {
    return {
      thread_id: routing.threadId,
      subject_type: undefined,
      subject_id: undefined,
      allow_unbound_thread: false
    };
  }

  if (routing.subjectType !== undefined && routing.subjectId !== undefined) {
    return {
      subject_type: routing.subjectType,
      subject_id: routing.subjectId,
      thread_id: undefined,
      allow_unbound_thread: false
    };
  }

  return {
    thread_id: undefined,
    subject_type: undefined,
    subject_id: undefined,
    allow_unbound_thread: routing.allowUnboundThread
  };
}

function mergeReminderInstructions(
  defaultInstructions: string,
  customInstructions: string | undefined
): string {
  const trimmedCustom = customInstructions?.trim();

  if (!trimmedCustom) {
    return defaultInstructions;
  }

  return `${defaultInstructions} ${trimmedCustom}`;
}
