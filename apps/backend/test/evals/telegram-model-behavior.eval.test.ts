import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { ToolDefinition } from "../../src/tools/tool-definition.js";
import type { JsonValue } from "../../src/shared/types/json.js";
import {
  createEvalRuntime as createBaseEvalRuntime,
  didRouteTo,
  findMatchingToolCall,
  mergeRecordedToolCalls,
  type RecordedToolCall,
  shouldRunOnlineEvals
} from "./eval-support.js";
import {
  telegramModelBehaviorCases,
  type TelegramModelBehaviorEvalCase
} from "./telegram-model-behavior.cases.js";

const runOnlineEvals = shouldRunOnlineEvals();

interface TelegramModelBehaviorOutput {
  activeAgentId: string;
  finalOutput: string;
  toolCalls: RecordedToolCall[];
}

describe.skipIf(!runOnlineEvals)("telegram model behavior eval", () => {
  it.each(telegramModelBehaviorCases)("$id", async (testCase) => {
    const output = await runTelegramModelBehaviorCase(testCase);

    if (testCase.expectedAgentId !== undefined) {
      const passed = didRouteTo(output, testCase.expectedAgentId);

      expect(
        passed,
        JSON.stringify(
          {
            id: testCase.id,
            expectedAgentId: testCase.expectedAgentId,
            actualActiveAgentId: output.activeAgentId,
            toolCalls: output.toolCalls
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
            toolCalls: output.toolCalls,
            finalOutput: output.finalOutput
          },
          null,
          2
        )
      ).toBeUndefined();
    }

    if (testCase.replyContent !== undefined) {
      const replyText = findReplyText(output);

      for (const requiredPattern of testCase.replyContent.requiredPatterns ?? []) {
        expect(replyText).toMatch(requiredPattern);
      }

      for (const forbiddenPattern of testCase.replyContent.forbiddenPatterns ?? []) {
        expect(replyText).not.toMatch(forbiddenPattern);
      }
    }

    if (testCase.replyStyle !== undefined) {
      const text = findReplyText(output);

      expect(text.length).toBeLessThanOrEqual(testCase.replyStyle.maxCharacters);

      for (const forbiddenPattern of testCase.replyStyle.forbiddenPatterns) {
        expect(text).not.toMatch(forbiddenPattern);
      }
    }
  }, 180_000);
});

async function runTelegramModelBehaviorCase(
  testCase: TelegramModelBehaviorEvalCase
): Promise<TelegramModelBehaviorOutput> {
  const recordedToolCalls: RecordedToolCall[] = [];
  const runtime = createEvalRuntime(recordedToolCalls, testCase);

  try {
    await runtime.initialize();

    const result = await runtime.executeTurn({
      agentId: "root_manager",
      input: testCase.input
    });

    return {
      activeAgentId: result.activeAgentId,
      finalOutput: result.finalOutput,
      toolCalls: mergeRecordedToolCalls(recordedToolCalls, result.newItems)
    };
  } finally {
    await runtime.close();
  }
}

function findReplyText(output: TelegramModelBehaviorOutput): string {
  const telegramCall = findMatchingToolCall(output, "telegram_send_message");

  return typeof telegramCall?.arguments.text === "string"
    ? telegramCall.arguments.text
    : output.finalOutput;
}

function createEvalRuntime(
  recordedToolCalls: RecordedToolCall[],
  testCase: TelegramModelBehaviorEvalCase
) {
  return createBaseEvalRuntime({
    telegramTools: [createTelegramSendMessageTool(recordedToolCalls)],
    shortcutTools: createShortcutTools(recordedToolCalls, testCase),
    cronTools: [createCronScheduleReminderTool(recordedToolCalls)]
  });
}

function createTelegramSendMessageTool(
  recordedToolCalls: RecordedToolCall[]
): ToolDefinition<{ chat_id: string; text: string }, JsonValue> {
  return {
    name: "telegram_send_message",
    description:
      "Send a natural plain-text Telegram chat reply to an existing chat using chat_id. Do not use Markdown, headings, bullet lists, tables, bold or italic markers, or code fences unless the user explicitly asks for that format.",
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

function createShortcutTools(
  recordedToolCalls: RecordedToolCall[],
  testCase: TelegramModelBehaviorEvalCase
): ToolDefinition[] {
  return [
    {
      name: "shortcut_post_comment",
      description: "Post a concise public comment to a Shortcut story.",
      inputSchema: z.object({
        story_public_id: z.string().min(1),
        text: z.string().min(1)
      }),
      outputSchema: z.object({
        ok: z.boolean(),
        story_public_id: z.string().min(1),
        comment_id: z.string().min(1).nullable(),
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

        if (testCase.failingToolName === "shortcut_post_comment") {
          return {
            ok: false,
            story_public_id: input.story_public_id,
            comment_id: null,
            text: "Shortcut API rejected the comment."
          };
        }

        return {
          ok: true,
          story_public_id: input.story_public_id,
          comment_id: "comment-1",
          text: input.text
        };
      }
    }
  ];
}

function createCronScheduleReminderTool(
  recordedToolCalls: RecordedToolCall[]
): ToolDefinition<
  { expression: string; message: string; one_time: boolean; agent_id: string | null },
  JsonValue
> {
  return {
    name: "cron_schedule_reminder",
    description:
      "Schedule a reminder. Use this only when the user provided enough detail to create a one-time or recurring reminder.",
    inputSchema: z.object({
      expression: z.string().min(1),
      message: z.string().min(1),
      one_time: z.boolean(),
      agent_id: z.string().min(1).nullable()
    }),
    outputSchema: z.object({
      ok: z.literal(true),
      job_id: z.string().min(1),
      expression: z.string().min(1),
      one_shot: z.boolean(),
      next_run_at: z.string().min(1),
      agent_id: z.string().min(1).nullable()
    }),
    sideEffecting: true,
    approvalRequired: false,
    idempotent: false,
    async execute(input) {
      recordedToolCalls.push({
        name: "cron_schedule_reminder",
        arguments: input
      });

      return {
        ok: true,
        job_id: "reminder-1",
        expression: input.expression,
        one_shot: input.one_time,
        next_run_at: "2026-05-06T09:00:00.000Z",
        agent_id: input.agent_id
      };
    }
  };
}
