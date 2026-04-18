import { z } from "zod";

import { normalizeShortcutIdentifier } from "./shortcut-client-helpers.js";

const shortcutIdentifierSchema = z.union([z.string().min(1), z.number().int().nonnegative()]);

const shortcutCommentAuthorProfileSchema = z
  .object({
    mention_name: z.string().min(1).optional(),
    name: z.string().min(1).optional()
  })
  .loose();

export const shortcutStoryCommentSchema = z
  .object({
    id: shortcutIdentifierSchema,
    text: z.string().optional(),
    author_id: shortcutIdentifierSchema.optional(),
    created_at: z.string().min(1).optional(),
    updated_at: z.string().min(1).optional(),
    app_url: z.string().min(1).optional(),
    author_profile: shortcutCommentAuthorProfileSchema.optional(),
    member_profile: shortcutCommentAuthorProfileSchema.optional()
  })
  .loose()
  .transform((comment) => ({
    ...comment,
    id: normalizeShortcutIdentifier(comment.id),
    author_id:
      comment.author_id === undefined ? null : normalizeShortcutIdentifier(comment.author_id),
    text: comment.text ?? "",
    created_at: comment.created_at ?? null,
    updated_at: comment.updated_at ?? null,
    app_url: comment.app_url ?? null,
    author_profile: comment.author_profile ?? comment.member_profile ?? null
  }));

const shortcutStoryLabelSchema = z
  .object({
    name: z.string().min(1)
  })
  .loose();

export const shortcutStorySchema = z
  .object({
    id: shortcutIdentifierSchema,
    name: z.string().min(1),
    description: z.string().optional(),
    app_url: z.string().min(1).optional(),
    story_type: z.enum(["feature", "bug", "chore"]).optional(),
    workflow_state_id: shortcutIdentifierSchema.optional(),
    comments: z.array(shortcutStoryCommentSchema).optional(),
    labels: z.array(shortcutStoryLabelSchema).optional()
  })
  .loose()
  .transform((story) => ({
    ...story,
    id: normalizeShortcutIdentifier(story.id),
    description: story.description ?? "",
    app_url: story.app_url ?? null,
    story_type: story.story_type ?? null,
    workflow_state_id:
      story.workflow_state_id === undefined
        ? null
        : normalizeShortcutIdentifier(story.workflow_state_id),
    comments: story.comments ?? [],
    labels: story.labels ?? []
  }));

const shortcutWorkflowStateSchema = z
  .object({
    id: shortcutIdentifierSchema,
    name: z.string().min(1)
  })
  .loose()
  .transform((state) => ({
    ...state,
    id: normalizeShortcutIdentifier(state.id)
  }));

export const shortcutWorkflowSchema = z
  .object({
    id: shortcutIdentifierSchema,
    name: z.string().min(1),
    states: z.array(shortcutWorkflowStateSchema).default([])
  })
  .loose()
  .transform((workflow) => ({
    ...workflow,
    id: normalizeShortcutIdentifier(workflow.id)
  }));

export const shortcutWebhookIntegrationSchema = z
  .object({
    id: shortcutIdentifierSchema,
    webhook_url: z.string().min(1),
    disabled: z.boolean().optional(),
    has_secret: z.boolean().optional()
  })
  .loose()
  .transform((integration) => ({
    ...integration,
    id: normalizeShortcutIdentifier(integration.id),
    disabled: integration.disabled ?? false,
    has_secret: integration.has_secret ?? false
  }));

export type ShortcutStoryComment = z.infer<typeof shortcutStoryCommentSchema>;
export type ShortcutStory = z.infer<typeof shortcutStorySchema>;
export type ShortcutWorkflow = z.infer<typeof shortcutWorkflowSchema>;
export type ShortcutWorkflowState = z.infer<typeof shortcutWorkflowStateSchema>;
export type ShortcutWebhookIntegration = z.infer<typeof shortcutWebhookIntegrationSchema>;
