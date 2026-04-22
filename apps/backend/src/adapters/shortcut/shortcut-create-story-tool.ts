import { z } from "zod";

import type { ToolDefinition } from "../../tools/tool-definition.js";
import {
  findShortcutWorkflowStateByName,
  type ShortcutClientLike
} from "./shortcut-client.js";

const shortcutStoryTypeSchema = z.enum(["feature", "bug", "chore"]);

const shortcutCreateStoryInputSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1).nullable(),
  workflow_state_name: z.string().min(1),
  story_type: shortcutStoryTypeSchema.nullable()
});

const shortcutCreateStoryOutputSchema = z.object({
  ok: z.literal(true),
  story_public_id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  workflow_state_id: z.string().min(1),
  workflow_state_name: z.string().min(1),
  story_type: shortcutStoryTypeSchema.nullable(),
  app_url: z.string().min(1).nullable()
});

type ShortcutCreateStoryInput = z.infer<typeof shortcutCreateStoryInputSchema>;
type ShortcutCreateStoryOutput = z.infer<typeof shortcutCreateStoryOutputSchema>;

export function createShortcutCreateStoryTool(options: {
  client: ShortcutClientLike;
}): ToolDefinition<ShortcutCreateStoryInput, ShortcutCreateStoryOutput> {
  return {
    name: "shortcut_create_story",
    description: "Create a new Shortcut story in the named workflow state.",
    inputSchema: shortcutCreateStoryInputSchema,
    outputSchema: shortcutCreateStoryOutputSchema,
    sideEffecting: true,
    approvalRequired: false,
    idempotent: false,
    async execute(input) {
      const workflows = await options.client.listWorkflows();
      const workflowState = findShortcutWorkflowStateByName(
        workflows,
        input.workflow_state_name
      );

      if (workflowState === null) {
        throw new Error(
          `Shortcut workflow state "${input.workflow_state_name}" was not found.`
        );
      }

      const story = await options.client.createStory({
        name: input.name,
        description: input.description ?? undefined,
        story_type: input.story_type ?? undefined,
        workflow_state_id: workflowState.id
      });

      return {
        ok: true,
        story_public_id: story.id,
        name: story.name,
        description: story.description,
        workflow_state_id: workflowState.id,
        workflow_state_name: workflowState.name,
        story_type: story.story_type,
        app_url: story.app_url
      };
    }
  };
}
