import {
  createTriggerEvent,
  triggerActorType,
  triggerSourceKind,
  type TriggerEvent
} from "../../execution/contracts/trigger-event.js";
import {
  findShortcutWorkflowStateName,
  type ShortcutStory,
  type ShortcutStoryComment,
  type ShortcutWorkflow
} from "./shortcut-client.js";
import { getShortcutAgentCommentPrefix } from "./shortcut-post-comment-tool.js";
import type {
  ShortcutAcceptedWebhookDelivery
} from "./shortcut-webhook-delivery.js";

const shortcutRecentCommentLimit = 6;

export interface ShortcutTriggerContext {
  delivery: ShortcutAcceptedWebhookDelivery;
  story: ShortcutStory;
  workflows: ShortcutWorkflow[];
  agentName: string;
}

export function createShortcutTriggerEvent(context: ShortcutTriggerContext): TriggerEvent {
  const { delivery, story, workflows, agentName } = context;
  const workflowStateName = findShortcutWorkflowStateName(workflows, story.workflow_state_id);
  const comment =
    delivery.eventType === "comment.created"
      ? resolveShortcutComment(story.comments, delivery.commentId)
      : null;

  return createTriggerEvent({
    trigger_id: `shortcut:webhook:${delivery.deliveryId}`,
    source: {
      kind: triggerSourceKind.webhook,
      system: "shortcut",
      event_type: delivery.eventType
    },
    actor: {
      type: getShortcutActorType(comment, delivery.memberId),
      id: getShortcutActorId(comment, delivery.memberId, agentName)
    },
    routing: {
      subject_type: "shortcut_story",
      subject_id: story.id
    },
    payload: {
      input: createShortcutPromptInput({
        comment,
        delivery,
        story,
        workflowStateName
      }),
      instructions: createShortcutInstructions(story.id)
    },
    received_at: delivery.receivedAt
  });
}

export function resolveShortcutComment(
  comments: ShortcutStory["comments"],
  commentId: string | null
): ShortcutStoryComment | null {
  if (comments.length === 0) {
    return null;
  }

  if (commentId !== null) {
    const matchingComment = comments.find((comment) => comment.id === commentId);

    if (matchingComment) {
      return matchingComment;
    }
  }

  return comments.at(-1) ?? null;
}

export function shouldIgnoreShortcutStoryComment(
  comment: ShortcutStoryComment | null,
  agentName: string
): boolean {
  if (comment === null) {
    return false;
  }

  return comment.text.trimStart().startsWith(getShortcutAgentCommentPrefix(agentName));
}

function getShortcutActorType(
  comment: ShortcutStoryComment | null,
  memberId: string | null
): TriggerEvent["actor"]["type"] {
  if (comment !== null && isAnyShortcutAgentComment(comment.text)) {
    return triggerActorType.agent;
  }

  if (comment !== null) {
    return triggerActorType.human;
  }

  if (memberId !== null) {
    return triggerActorType.human;
  }

  return triggerActorType.system;
}

function getShortcutActorId(
  comment: ShortcutStoryComment | null,
  memberId: string | null,
  agentName: string
): string {
  if (comment !== null && isAnyShortcutAgentComment(comment.text)) {
    return `agent:${getShortcutAgentName(comment.text) ?? agentName}`;
  }

  if (comment?.author_id) {
    return comment.author_id;
  }

  if (memberId !== null) {
    return memberId;
  }

  return "shortcut";
}

function createShortcutPromptInput(options: {
  comment: ShortcutStoryComment | null;
  delivery: ShortcutAcceptedWebhookDelivery;
  story: ShortcutStory;
  workflowStateName: string | null;
}): string {
  const lines = [
    "Shortcut story update",
    `Event: ${options.delivery.eventType}`,
    `Story ID: ${options.story.id}`,
    `Title: ${options.story.name}`,
    options.workflowStateName !== null ? `Status: ${options.workflowStateName}` : null,
    options.story.app_url !== null ? `Story URL: ${options.story.app_url}` : null,
    options.story.labels.length > 0
      ? `Labels: ${options.story.labels.map((label) => label.name).join(", ")}`
      : null,
    "",
    "Description:",
    options.story.description.trim().length > 0 ? options.story.description : "(none)"
  ];

  if (options.comment !== null) {
    lines.push("", "New comment:", formatShortcutCommentLine(options.comment));
  }

  const recentComments = options.story.comments.slice(-shortcutRecentCommentLimit);

  if (recentComments.length > 0) {
    lines.push("", "Recent comments:");

    for (const comment of recentComments) {
      lines.push(`- ${formatShortcutCommentLine(comment)}`);
    }
  }

  return lines.filter((line): line is string => line !== null).join("\n");
}

function createShortcutInstructions(storyPublicId: string): string {
  return [
    "This input came from Shortcut.",
    "Each Shortcut story maps to one Pineapple thread.",
    "Use concise public comments suitable for humans collaborating in Shortcut.",
    `When you need to reply in Shortcut, call shortcut_post_comment with story_public_id=${storyPublicId}.`,
    `When you need to update the story, call shortcut_update_story with story_public_id=${storyPublicId}.`
  ].join(" ");
}

function formatShortcutCommentLine(comment: ShortcutStoryComment): string {
  return `${getShortcutCommentAuthorLabel(comment)}: ${comment.text.trim() || "(empty comment)"}`;
}

function getShortcutCommentAuthorLabel(comment: ShortcutStoryComment): string {
  const profile = comment.author_profile;

  if (profile?.name && profile.mention_name) {
    return `${profile.name} @${profile.mention_name}`;
  }

  if (profile?.name) {
    return profile.name;
  }

  if (profile?.mention_name) {
    return `@${profile.mention_name}`;
  }

  if (comment.author_id !== null) {
    return `member:${comment.author_id}`;
  }

  return "unknown";
}

function isAnyShortcutAgentComment(text: string): boolean {
  return /^\[agent:[^\]]+\]/i.test(text.trimStart());
}

function getShortcutAgentName(text: string): string | null {
  const match = text.trimStart().match(/^\[agent:([^\]]+)\]/i);
  return match?.[1]?.trim() || null;
}
