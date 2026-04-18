import { z } from "zod";

import type { ToolDefinition } from "../../tools/tool-definition.js";
import type { ShortcutClientLike } from "./shortcut-client.js";

const shortcutPostCommentInputSchema = z.object({
  story_public_id: z.string().min(1),
  text: z.string().min(1)
});

const shortcutPostCommentOutputSchema = z.object({
  ok: z.literal(true),
  story_public_id: z.string().min(1),
  comment_id: z.string().min(1),
  text: z.string()
});

type ShortcutPostCommentInput = z.infer<typeof shortcutPostCommentInputSchema>;
type ShortcutPostCommentOutput = z.infer<typeof shortcutPostCommentOutputSchema>;

export function createShortcutPostCommentTool(options: {
  agentName: string;
  client: ShortcutClientLike;
}): ToolDefinition<ShortcutPostCommentInput, ShortcutPostCommentOutput> {
  return {
    name: "shortcut_post_comment",
    description:
      "Post a concise public comment to a Shortcut story. The configured agent identity prefix is added automatically.",
    inputSchema: shortcutPostCommentInputSchema,
    outputSchema: shortcutPostCommentOutputSchema,
    sideEffecting: true,
    approvalRequired: false,
    idempotent: false,
    async execute(input) {
      const result = await options.client.createStoryComment(input.story_public_id, {
        text: formatShortcutAgentComment(options.agentName, input.text)
      });

      return {
        ok: true,
        story_public_id: input.story_public_id,
        comment_id: result.id,
        text: result.text
      };
    }
  };
}

function formatShortcutAgentComment(agentName: string, text: string): string {
  return `${getShortcutAgentCommentPrefix(agentName)} ${text.trim()}`.trim();
}

export function getShortcutAgentCommentPrefix(agentName: string): string {
  return `[agent:${agentName.trim()}]`;
}
