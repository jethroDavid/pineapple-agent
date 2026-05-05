import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { ShortcutStory, ShortcutWorkflow } from "../../src/adapters/shortcut/shortcut-client.js";
import { createShortcutTriggerEvent } from "../../src/adapters/shortcut/shortcut-webhook.js";
import { createTelegramTriggerEvent } from "../../src/adapters/telegram/telegram-webhook.js";
import { telegramThreadContextPromptEnricher } from "../../src/adapters/telegram/telegram-trigger-prompt-enricher.js";
import type { TriggerEvent } from "../../src/execution/contracts/trigger-event.js";
import { dispatchExecutionRequest } from "../../src/execution/pipeline/dispatch.js";
import type { JsonValue } from "../../src/shared/types/json.js";
import type { ToolDefinition } from "../../src/tools/tool-definition.js";
import {
  InMemoryAgentExecutionDecisionStore,
  InMemoryAgentExecutionStore
} from "../support/in-memory-agent-execution-stores.js";
import { InMemoryThreadStore } from "../support/in-memory-thread-store.js";
import {
  createEvalRuntime as createBaseEvalRuntime,
  didRouteTo,
  findMatchingToolCall,
  mergeRecordedToolCalls,
  type RecordedToolCall,
  shouldRunOnlineEvals
} from "./eval-support.js";
import {
  shortcutCrossAdapterCases,
  type ShortcutCrossAdapterEvalCase
} from "./shortcut-cross-adapter.cases.js";

const runOnlineEvals = shouldRunOnlineEvals();

interface ShortcutCrossAdapterOutput {
  entrypointAgentId: string;
  activeAgentId: string;
  finalOutput: string | null;
  toolCalls: RecordedToolCall[];
}

describe.skipIf(!runOnlineEvals)("shortcut cross-adapter behavior eval", () => {
  it.each(shortcutCrossAdapterCases)("$id", async (testCase) => {
    const output = await runShortcutCrossAdapterCase(testCase);

    if (testCase.expectedAgentId !== undefined) {
      const passed = didRouteTo(output, testCase.expectedAgentId);

      expect(
        passed,
        JSON.stringify(
          {
            id: testCase.id,
            expectedAgentId: testCase.expectedAgentId,
            entrypointAgentId: output.entrypointAgentId,
            actualActiveAgentId: output.activeAgentId,
            toolCalls: output.toolCalls,
            finalOutput: output.finalOutput
          },
          null,
          2
        )
      ).toBe(true);
    }

    if (testCase.expectedToolCall !== undefined) {
      const matchingCall = findMatchingToolCall(output, testCase.expectedToolCall.name);

      expect(
        matchingCall,
        JSON.stringify(
          {
            id: testCase.id,
            expectedToolCall: testCase.expectedToolCall,
            entrypointAgentId: output.entrypointAgentId,
            activeAgentId: output.activeAgentId,
            toolCalls: output.toolCalls,
            finalOutput: output.finalOutput
          },
          null,
          2
        )
      ).toBeDefined();

      for (const [key, expectedValue] of Object.entries(
        testCase.expectedToolCall.arguments ?? {}
      )) {
        expect(matchingCall?.arguments[key]).toBe(expectedValue);
      }
    }

    for (const forbiddenToolName of testCase.expectedNoToolCalls ?? []) {
      expect(
        findMatchingToolCall(output, forbiddenToolName),
        JSON.stringify(
          {
            id: testCase.id,
            forbiddenToolName,
            entrypointAgentId: output.entrypointAgentId,
            activeAgentId: output.activeAgentId,
            toolCalls: output.toolCalls,
            finalOutput: output.finalOutput
          },
          null,
          2
        )
      ).toBeUndefined();
    }
  }, 180_000);
});

async function runShortcutCrossAdapterCase(
  testCase: ShortcutCrossAdapterEvalCase
): Promise<ShortcutCrossAdapterOutput> {
  const recordedToolCalls: RecordedToolCall[] = [];
  const threadStore = new InMemoryThreadStore();
  const runtime = createEvalRuntime(recordedToolCalls, threadStore);

  try {
    await runtime.initialize();

    if (testCase.kind === "shortcut_trigger") {
      return await runShortcutTriggerCase(recordedToolCalls, runtime, threadStore);
    }

    return await runTelegramBoundThreadCase(recordedToolCalls, runtime, threadStore);
  } finally {
    await runtime.close();
  }
}

async function runShortcutTriggerCase(
  recordedToolCalls: RecordedToolCall[],
  runtime: ReturnType<typeof createEvalRuntime>,
  threadStore: InMemoryThreadStore
): Promise<ShortcutCrossAdapterOutput> {
  const triggerEvent = createShortcutTriggerEvent({
    delivery: {
      kind: "accepted",
      deliveryId: "shortcut-start-repo-work",
      eventType: "comment.created",
      storyPublicId: "123",
      commentId: "5001",
      memberId: "member-1",
      receivedAt: "2026-05-05T12:00:00.000Z"
    },
    story: createShortcutStory({
      comments: [
        {
          id: "5001",
          text: "Start working on this.",
          author_id: "member-1",
          created_at: "2026-05-05T12:00:00.000Z",
          updated_at: "2026-05-05T12:00:00.000Z",
          app_url: null,
          author_profile: {
            name: "Jethro",
            mention_name: "jethro"
          }
        }
      ]
    }),
    workflows: createShortcutWorkflows(),
    agentName: "pineapple"
  });

  return await dispatchEvalTrigger(triggerEvent, recordedToolCalls, runtime, threadStore);
}

async function runTelegramBoundThreadCase(
  recordedToolCalls: RecordedToolCall[],
  runtime: ReturnType<typeof createEvalRuntime>,
  threadStore: InMemoryThreadStore
): Promise<ShortcutCrossAdapterOutput> {
  const thread = await threadStore.create({
    subjectType: "shortcut_story",
    subjectId: "123"
  });
  const triggerEvent = createTelegramTriggerEvent({
    update: {
      kind: "accepted",
      updateId: 7001,
      eventType: "message",
      command: null,
      message: {
        actorId: "5001",
        actorType: "human",
        chatId: "5001",
        chatType: "private",
        chatTitle: null,
        chatUsername: null,
        messageId: 42,
        messageThreadId: null,
        replyToMessageId: null,
        senderLabel: "Jethro (5001)",
        text: "Post an update on this story saying the backend failure is reproduced.",
        receivedAt: "2026-05-05T12:05:00.000Z"
      }
    },
    threadId: thread.threadId
  });

  return await dispatchEvalTrigger(triggerEvent, recordedToolCalls, runtime, threadStore);
}

async function dispatchEvalTrigger(
  triggerEvent: TriggerEvent,
  recordedToolCalls: RecordedToolCall[],
  runtime: ReturnType<typeof createEvalRuntime>,
  threadStore: InMemoryThreadStore
): Promise<ShortcutCrossAdapterOutput> {
  const result = await dispatchExecutionRequest(
    {
      kind: "trigger",
      triggerEvent
    },
    {
      daemon: null,
      agentRuntime: runtime,
      threadStore,
      agentExecutionStore: new InMemoryAgentExecutionStore(),
      agentExecutionDecisionStore: new InMemoryAgentExecutionDecisionStore(),
      triggerPromptEnrichers: [telegramThreadContextPromptEnricher]
    }
  );

  return {
    entrypointAgentId: result.execution.entrypointAgentId,
    activeAgentId: result.activeAgentId,
    finalOutput: result.finalOutput,
    toolCalls: mergeRecordedToolCalls(
      recordedToolCalls,
      result.usedTools.map((tool) => ({
        name: tool.name,
        arguments: {}
      }))
    )
  };
}

function createEvalRuntime(
  recordedToolCalls: RecordedToolCall[],
  threadStore: InMemoryThreadStore
) {
  return createBaseEvalRuntime({
    threadStore,
    telegramTools: [createTelegramSendMessageTool(recordedToolCalls)],
    shortcutTools: [
      createShortcutPostCommentTool(recordedToolCalls),
      createShortcutUpdateStoryTool(recordedToolCalls)
    ]
  });
}

function createTelegramSendMessageTool(
  recordedToolCalls: RecordedToolCall[]
): ToolDefinition<{ chat_id: string; text: string }, JsonValue> {
  return {
    name: "telegram_send_message",
    description:
      "Send a natural plain-text Telegram chat reply to an existing chat using chat_id.",
    inputSchema: z.object({
      chat_id: z.string().min(1),
      text: z.string().min(1)
    }),
    outputSchema: z.object({
      ok: z.literal(true),
      message_id: z.number().int(),
      chat_id: z.number().int(),
      chat_type: z.string().min(1),
      date: z.number().int()
    }),
    sideEffecting: true,
    approvalRequired: false,
    idempotent: false,
    async execute(input) {
      recordedToolCalls.push({
        name: "telegram_send_message",
        arguments: input
      });

      return {
        ok: true,
        message_id: 1,
        chat_id: Number.parseInt(input.chat_id, 10),
        chat_type: "private",
        date: 1
      };
    }
  };
}

function createShortcutPostCommentTool(
  recordedToolCalls: RecordedToolCall[]
): ToolDefinition<{ story_public_id: string; text: string }, JsonValue> {
  return {
    name: "shortcut_post_comment",
    description: "Post a concise public comment to a Shortcut story.",
    inputSchema: z.object({
      story_public_id: z.string().min(1),
      text: z.string().min(1)
    }),
    outputSchema: z.object({
      ok: z.literal(true),
      story_public_id: z.string().min(1),
      comment_id: z.string().min(1),
      text: z.string()
    }),
    sideEffecting: true,
    approvalRequired: false,
    idempotent: false,
    async execute(input) {
      recordedToolCalls.push({
        name: "shortcut_post_comment",
        arguments: input
      });

      return {
        ok: true,
        story_public_id: input.story_public_id,
        comment_id: "comment-1",
        text: input.text
      };
    }
  };
}

function createShortcutUpdateStoryTool(
  recordedToolCalls: RecordedToolCall[]
): ToolDefinition<
  {
    story_public_id: string;
    name: string | null;
    description: string | null;
    workflow_state_name: string | null;
    story_type: "feature" | "bug" | "chore" | null;
  },
  JsonValue
> {
  return {
    name: "shortcut_update_story",
    description: "Update Shortcut story fields such as workflow state.",
    inputSchema: z
      .object({
        story_public_id: z.string().min(1),
        name: z.string().min(1).nullable(),
        description: z.string().min(1).nullable(),
        workflow_state_name: z.string().min(1).nullable(),
        story_type: z.enum(["feature", "bug", "chore"]).nullable()
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
      ),
    outputSchema: z.object({
      ok: z.literal(true),
      story_public_id: z.string().min(1)
    }),
    sideEffecting: true,
    approvalRequired: false,
    idempotent: false,
    async execute(input) {
      recordedToolCalls.push({
        name: "shortcut_update_story",
        arguments: input
      });

      return {
        ok: true,
        story_public_id: input.story_public_id
      };
    }
  };
}

function createShortcutStory(input: {
  comments: ShortcutStory["comments"];
}): ShortcutStory {
  return {
    id: "123",
    name: "Fix backend adapter regression",
    description:
      "The backend Vitest suite fails after the Shortcut adapter change. Inspect the repo, fix the regression, and validate the backend tests.",
    app_url: "https://app.shortcut.com/pineapple/story/123",
    story_type: "bug",
    workflow_state_id: "2",
    labels: [
      {
        name: "backend"
      }
    ],
    comments: input.comments
  };
}

function createShortcutWorkflows(): ShortcutWorkflow[] {
  return [
    {
      id: "workflow-1",
      name: "Default",
      states: [
        {
          id: "2",
          name: "Ready for Development"
        }
      ]
    }
  ];
}
