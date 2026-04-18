import { z } from "zod";

import type { ToolDefinition } from "../../tools/tool-definition.js";
import {
  findShortcutWorkflowStateByName,
  findShortcutWorkflowStateName,
  type ShortcutClientLike,
  type ShortcutWorkflow
} from "./shortcut-client.js";

const shortcutStoryTypeSchema = z.enum(["feature", "bug", "chore"]);

const shortcutUpdateStoryInputSchema = z
  .object({
    story_public_id: z.string().min(1),
    name: z.string().min(1).nullable(),
    description: z.string().min(1).nullable(),
    workflow_state_name: z.string().min(1).nullable(),
    story_type: shortcutStoryTypeSchema.nullable()
  })
  .refine(
    (input) =>
      input.name !== null ||
      input.description !== null ||
      input.workflow_state_name !== null ||
      input.story_type !== null,
    {
      message:
        "shortcut_update_story requires at least one of name, description, workflow_state_name, or story_type."
    }
  );

const shortcutUpdateStoryOutputSchema = z.object({
  ok: z.literal(true),
  story_public_id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  workflow_state_id: z.string().nullable(),
  workflow_state_name: z.string().nullable(),
  story_type: shortcutStoryTypeSchema.nullable(),
  app_url: z.string().min(1).nullable()
});

type ShortcutUpdateStoryInput = z.infer<typeof shortcutUpdateStoryInputSchema>;
type ShortcutUpdateStoryOutput = z.infer<typeof shortcutUpdateStoryOutputSchema>;

export function createShortcutUpdateStoryTool(options: {
  client: ShortcutClientLike;
}): ToolDefinition<ShortcutUpdateStoryInput, ShortcutUpdateStoryOutput> {
  return {
    name: "shortcut_update_story",
    description:
      "Update an existing Shortcut story's title, description, type, and/or workflow state.",
    inputSchema: shortcutUpdateStoryInputSchema,
    outputSchema: shortcutUpdateStoryOutputSchema,
    sideEffecting: true,
    approvalRequired: false,
    idempotent: false,
    async execute(input) {
      const workflows =
        input.workflow_state_name === null
          ? null
          : await options.client.listWorkflows();
      const workflowState = resolveWorkflowState(workflows, input.workflow_state_name);
      const story = await options.client.updateStory(input.story_public_id, {
        name: input.name ?? undefined,
        description: input.description ?? undefined,
        story_type: input.story_type ?? undefined,
        workflow_state_id: workflowState?.id
      });
      const resolvedWorkflowStateName =
        workflows === null
          ? null
          : findShortcutWorkflowStateName(workflows, story.workflow_state_id);

      return {
        ok: true,
        story_public_id: story.id,
        name: story.name,
        description: story.description,
        workflow_state_id: story.workflow_state_id,
        workflow_state_name: resolvedWorkflowStateName,
        story_type: story.story_type,
        app_url: story.app_url
      };
    }
  };
}

function resolveWorkflowState(
  workflows: ShortcutWorkflow[] | null,
  workflowStateName: string | null
) {
  if (workflowStateName === null) {
    return null;
  }

  const workflowState =
    workflows === null ? null : findShortcutWorkflowStateByName(workflows, workflowStateName);

  if (workflowState === null) {
    throw new Error(`Shortcut workflow state "${workflowStateName}" was not found.`);
  }

  return workflowState;
}
