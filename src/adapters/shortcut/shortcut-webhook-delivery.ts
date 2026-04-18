import { z } from "zod";

import { normalizeShortcutIdentifier } from "./shortcut-client.js";

export const shortcutWebhookPath = "/adapters/shortcut/webhook";

const shortcutIdentifierSchema = z.union([z.string().min(1), z.number().int().nonnegative()]);

const shortcutWebhookActionSchema = z
  .object({
    entity_type: z.string().min(1),
    action: z.string().min(1),
    id: shortcutIdentifierSchema.optional(),
    story_id: shortcutIdentifierSchema.optional(),
    changes: z.record(z.string(), z.unknown()).optional()
  })
  .loose();

const shortcutWebhookDeliverySchema = z
  .object({
    id: shortcutIdentifierSchema,
    primary_id: shortcutIdentifierSchema.optional(),
    member_id: shortcutIdentifierSchema.optional(),
    changed: z.string().min(1).optional(),
    changed_at: z.string().min(1).optional(),
    actions: z.array(shortcutWebhookActionSchema).min(1)
  })
  .loose();

type ShortcutWebhookAction = z.infer<typeof shortcutWebhookActionSchema>;
type ShortcutWebhookDelivery = z.infer<typeof shortcutWebhookDeliverySchema>;

export const shortcutIgnoredReason = {
  ambiguousStoryTarget: "ambiguous_story_target",
  selfAuthoredComment: "self_authored_comment",
  unsupportedDelivery: "unsupported_delivery"
} as const;

export type ShortcutIgnoredReason =
  (typeof shortcutIgnoredReason)[keyof typeof shortcutIgnoredReason];

export interface ShortcutAcceptedWebhookDelivery {
  kind: "accepted";
  deliveryId: string;
  eventType: "story.created" | "story.updated" | "comment.created";
  storyPublicId: string;
  commentId: string | null;
  memberId: string | null;
  receivedAt: string;
}

export interface ShortcutIgnoredWebhookDelivery {
  kind: "ignored";
  deliveryId: string;
  reason: ShortcutIgnoredReason;
}

export type ShortcutWebhookDeliveryResult =
  | ShortcutAcceptedWebhookDelivery
  | ShortcutIgnoredWebhookDelivery;

export function normalizeShortcutWebhookDelivery(
  input: unknown
): ShortcutWebhookDeliveryResult {
  const delivery = shortcutWebhookDeliverySchema.parse(input);
  const eventType = detectShortcutEventType(delivery.actions);

  if (eventType === null) {
    return {
      kind: "ignored",
      deliveryId: normalizeShortcutIdentifier(delivery.id),
      reason: shortcutIgnoredReason.unsupportedDelivery
    };
  }

  const storyIds = collectShortcutStoryIds(delivery, eventType);

  if (storyIds.length !== 1) {
    return {
      kind: "ignored",
      deliveryId: normalizeShortcutIdentifier(delivery.id),
      reason: shortcutIgnoredReason.ambiguousStoryTarget
    };
  }

  return {
    kind: "accepted",
    deliveryId: normalizeShortcutIdentifier(delivery.id),
    eventType,
    storyPublicId: storyIds[0],
    commentId: getShortcutCommentId(delivery.actions),
    memberId:
      delivery.member_id === undefined ? null : normalizeShortcutIdentifier(delivery.member_id),
    receivedAt: delivery.changed_at ?? delivery.changed ?? new Date().toISOString()
  };
}

function detectShortcutEventType(
  actions: ShortcutWebhookAction[]
): ShortcutAcceptedWebhookDelivery["eventType"] | null {
  if (hasShortcutCommentCreateAction(actions)) {
    return "comment.created";
  }

  if (actions.some((action) => isShortcutStoryAction(action, "create"))) {
    return "story.created";
  }

  if (actions.some((action) => isMaterialShortcutStoryUpdate(action))) {
    return "story.updated";
  }

  return null;
}

function hasShortcutCommentCreateAction(actions: ShortcutWebhookAction[]): boolean {
  return actions.some(
    (action) =>
      action.action === "create" &&
      (action.entity_type === "comment" || action.entity_type === "story-comment")
  );
}

function isShortcutStoryAction(
  action: ShortcutWebhookAction,
  actionName: string
): boolean {
  return action.entity_type === "story" && action.action === actionName;
}

function isMaterialShortcutStoryUpdate(action: ShortcutWebhookAction): boolean {
  if (!isShortcutStoryAction(action, "update")) {
    return false;
  }

  if (action.changes === undefined) {
    return true;
  }

  return ["name", "description"].some((field) => field in action.changes!);
}

function collectShortcutStoryIds(
  delivery: ShortcutWebhookDelivery,
  eventType: ShortcutAcceptedWebhookDelivery["eventType"]
): string[] {
  const storyIds = new Set<string>();

  for (const action of delivery.actions) {
    if (action.entity_type === "story" && action.id !== undefined) {
      storyIds.add(normalizeShortcutIdentifier(action.id));
    }

    if (action.story_id !== undefined) {
      storyIds.add(normalizeShortcutIdentifier(action.story_id));
    }

    const changesStoryId = getShortcutIdentifierFromChange(action.changes?.story_id);

    if (changesStoryId !== null) {
      storyIds.add(changesStoryId);
    }

    const changesStoryPublicId = getShortcutIdentifierFromChange(
      action.changes?.story_public_id
    );

    if (changesStoryPublicId !== null) {
      storyIds.add(changesStoryPublicId);
    }
  }

  if (storyIds.size === 0 && delivery.primary_id !== undefined) {
    storyIds.add(normalizeShortcutIdentifier(delivery.primary_id));
  }

  if (eventType === "comment.created" && storyIds.size > 1 && delivery.primary_id !== undefined) {
    return [normalizeShortcutIdentifier(delivery.primary_id)];
  }

  return [...storyIds];
}

function getShortcutIdentifierFromChange(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }

  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return String(value);
  }

  return null;
}

function getShortcutCommentId(actions: ShortcutWebhookAction[]): string | null {
  const commentAction = actions.find(
    (action) =>
      action.action === "create" &&
      (action.entity_type === "comment" || action.entity_type === "story-comment")
  );

  if (commentAction?.id === undefined) {
    return null;
  }

  return normalizeShortcutIdentifier(commentAction.id);
}
