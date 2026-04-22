import { z } from "zod";

export const triggerEventVersion = 1 as const;

export const triggerSourceKind = {
  webhook: "webhook",
  cli: "cli",
  http: "http",
  system: "system"
} as const;

const triggerSourceKinds = [
  triggerSourceKind.webhook,
  triggerSourceKind.cli,
  triggerSourceKind.http,
  triggerSourceKind.system
] as const;

export const triggerActorType = {
  human: "human",
  system: "system",
  agent: "agent",
  unknown: "unknown"
} as const;

const triggerActorTypes = [
  triggerActorType.human,
  triggerActorType.system,
  triggerActorType.agent,
  triggerActorType.unknown
] as const;

const triggerSourceSchema = z.object({
  kind: z.enum(triggerSourceKinds),
  system: z.string().min(1),
  event_type: z.string().min(1)
});

const triggerActorSchema = z.object({
  type: z.enum(triggerActorTypes),
  id: z.string().min(1)
});

const triggerRoutingInputSchema = z.object({
  thread_id: z.string().min(1).optional(),
  subject_type: z.string().min(1).optional(),
  subject_id: z.string().min(1).optional(),
  allow_unbound_thread: z.boolean().optional()
});

const triggerRoutingSchema = triggerRoutingInputSchema
  .transform((routing) => ({
    thread_id: routing.thread_id,
    subject_type: routing.subject_type,
    subject_id: routing.subject_id,
    allow_unbound_thread: routing.allow_unbound_thread ?? false
  }))
  .superRefine((routing, ctx) => {
    const hasThreadId = routing.thread_id !== undefined;
    const hasSubjectType = routing.subject_type !== undefined;
    const hasSubjectId = routing.subject_id !== undefined;
    const hasSubjectBinding = hasSubjectType && hasSubjectId;

    if (hasSubjectType !== hasSubjectId) {
      ctx.addIssue({
        code: "custom",
        message: "subject_type and subject_id must be provided together.",
        path: hasSubjectType ? ["subject_id"] : ["subject_type"]
      });
    }

    if (!hasThreadId && !hasSubjectBinding && routing.allow_unbound_thread !== true) {
      ctx.addIssue({
        code: "custom",
        message:
          "TriggerEvent routing requires thread_id, subject_type plus subject_id, or allow_unbound_thread=true."
      });
    }
  });

export const triggerEventSchema = z.object({
  version: z.literal(triggerEventVersion),
  trigger_id: z.string().min(1),
  source: triggerSourceSchema,
  actor: triggerActorSchema,
  routing: triggerRoutingSchema,
  payload: z.unknown(),
  received_at: z.iso.datetime()
});

export type TriggerEvent = z.infer<typeof triggerEventSchema>;

const newTriggerEventSchema = z.object({
  trigger_id: z.string().min(1),
  source: triggerSourceSchema,
  actor: triggerActorSchema,
  routing: triggerRoutingInputSchema,
  payload: z.unknown(),
  received_at: z.iso.datetime().optional()
});

type NewTriggerEvent = z.input<typeof newTriggerEventSchema>;

export function createTriggerEvent(input: NewTriggerEvent): TriggerEvent {
  const parsed = newTriggerEventSchema.parse(input);

  return triggerEventSchema.parse({
    version: triggerEventVersion,
    trigger_id: parsed.trigger_id,
    source: parsed.source,
    actor: parsed.actor,
    routing: parsed.routing,
    payload: parsed.payload,
    received_at: parsed.received_at ?? new Date().toISOString()
  });
}

export function restoreTriggerEvent(input: TriggerEvent): TriggerEvent {
  return triggerEventSchema.parse(input);
}

export function hasDirectThreadRouting(triggerEvent: TriggerEvent): boolean {
  return triggerEvent.routing.thread_id !== undefined;
}

export function hasSubjectRouting(triggerEvent: TriggerEvent): boolean {
  return (
    triggerEvent.routing.subject_type !== undefined &&
    triggerEvent.routing.subject_id !== undefined
  );
}

export function allowsUnboundThread(triggerEvent: TriggerEvent): boolean {
  return triggerEvent.routing.allow_unbound_thread;
}
