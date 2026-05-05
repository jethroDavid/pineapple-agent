import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  createCronReminderJobDefinition,
  createCronReminderTriggerEvent
} from "../../src/adapters/cron/cron-reminder.js";
import { telegramReminderTriggerPromptEnricher } from "../../src/adapters/telegram/telegram-trigger-prompt-enricher.js";
import { dispatchExecutionRequest } from "../../src/execution/pipeline/dispatch.js";
import type { JsonValue } from "../../src/shared/types/json.js";
import { createThreadMetadata } from "../../src/threads/domain/thread-metadata.js";
import type { ToolDefinition } from "../../src/tools/tool-definition.js";
import {
  InMemoryAgentExecutionDecisionStore,
  InMemoryAgentExecutionStore
} from "../support/in-memory-agent-execution-stores.js";
import { InMemoryThreadStore } from "../support/in-memory-thread-store.js";
import {
  createEvalRuntime as createBaseEvalRuntime,
  findMatchingToolCall,
  mergeRecordedToolCalls,
  type RecordedToolCall,
  shouldRunOnlineEvals
} from "./eval-support.js";
import {
  cronTriggerRoutingCases,
  type CronTriggerRoutingEvalCase
} from "./cron-trigger-routing.cases.js";

const runOnlineEvals = shouldRunOnlineEvals();

interface CronTriggerRoutingOutput {
  entrypointAgentId: string;
  activeAgentId: string;
  finalOutput: string | null;
  toolCalls: RecordedToolCall[];
}

describe.skipIf(!runOnlineEvals)("cron trigger routing eval", () => {
  it.each(cronTriggerRoutingCases)("$id", async (testCase) => {
    const output = await runCronTriggerRoutingCase(testCase);

    expect(output.entrypointAgentId).toBe(testCase.expectedEntrypointAgentId);

    if (testCase.expectedActiveAgentId !== undefined) {
      expect(output.activeAgentId).toBe(testCase.expectedActiveAgentId);
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

async function runCronTriggerRoutingCase(
  testCase: CronTriggerRoutingEvalCase
): Promise<CronTriggerRoutingOutput> {
  const recordedToolCalls: RecordedToolCall[] = [];
  const threadStore = new InMemoryThreadStore();
  const thread = await threadStore.create({
    threadMetadata: createThreadMetadata({
      deliveryContext: {
        telegram: {
          chatId: "5001",
          chatType: "private"
        }
      }
    })
  });
  const runtime = createEvalRuntime(recordedToolCalls, threadStore);

  try {
    await runtime.initialize();

    const triggerEvent = createCronReminderTriggerEvent(
      createCronReminderJobDefinition({
        id: testCase.id,
        expression: "0 9 * * *",
        message: testCase.message,
        instructions: [
          "This scheduled tick should execute the scheduled work now.",
          "Do not create a new reminder for this tick."
        ].join(" "),
        agentId: testCase.agentId,
        routing: {
          threadId: thread.threadId,
          allowUnboundThread: false
        }
      }),
      new Date("2026-05-06T09:00:00.000Z")
    );

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
        triggerPromptEnrichers: [telegramReminderTriggerPromptEnricher]
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
  } finally {
    await runtime.close();
  }
}

function createEvalRuntime(
  recordedToolCalls: RecordedToolCall[],
  threadStore: InMemoryThreadStore
) {
  return createBaseEvalRuntime({
    assistantAudioBridgeTools: createSpotifyTools(recordedToolCalls),
    threadStore,
    telegramTools: [createTelegramSendMessageTool(recordedToolCalls)],
    cronTools: [createCronScheduleReminderTool(recordedToolCalls)]
  });
}

function createSpotifyTools(recordedToolCalls: RecordedToolCall[]): ToolDefinition[] {
  return [
    {
      name: "assistant_bridge_spotify_play_playlist",
      description: "Play a Spotify playlist by id, URI, or unambiguous playlist name.",
      inputSchema: z.object({
        playlist: z.string().min(1)
      }),
      outputSchema: z.object({
        ok: z.literal(true),
        playlist: z.string().min(1)
      }),
      sideEffecting: true,
      approvalRequired: false,
      idempotent: false,
      async execute(input) {
        recordedToolCalls.push({
          name: "assistant_bridge_spotify_play_playlist",
          arguments: input
        });

        return {
          ok: true,
          playlist: input.playlist
        };
      }
    }
  ];
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

function createCronScheduleReminderTool(
  recordedToolCalls: RecordedToolCall[]
): ToolDefinition<
  { expression: string; message: string; one_time: boolean; agent_id: string | null },
  JsonValue
> {
  return {
    name: "cron_schedule_reminder",
    description:
      "Schedule a reminder. Do not use this when handling an already-fired cron reminder tick.",
    inputSchema: z.object({
      expression: z.string().min(1),
      message: z.string().min(1),
      one_time: z.boolean(),
      agent_id: z.string().min(1).nullable()
    }),
    outputSchema: z.object({
      ok: z.literal(true),
      job_id: z.string().min(1)
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
        job_id: "unexpected-reminder"
      };
    }
  };
}
