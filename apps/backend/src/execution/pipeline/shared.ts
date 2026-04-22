import type { AgentInputItem, RunItem } from "@openai/agents";

import type { AppAgentRuntime } from "../../agents/agent-runtime.js";
import { AgentThreadNotFoundError } from "../../agents/errors.js";
import {
  applyThreadMetadataPatch,
  updateThreadLastResponse,
  type Thread
} from "../../threads/domain/thread.js";
import type { ThreadStore } from "../../threads/store/thread-store.js";
import type { AgentExecution } from "../domain/agent-execution.js";
import type { ExecutionToolUse } from "../execution-contracts.js";

export function normalizeTurnInput(
  input: string | AgentInputItem[],
  instructions?: string
): Pick<AgentExecution["checkpoint"], "inputItems"> {
  if (Array.isArray(input)) {
    return {
      inputItems: instructions
        ? [{ role: "system", content: instructions }, ...input]
        : input
    };
  }

  return {
    inputItems: instructions
      ? [
          {
            role: "system",
            content: instructions
          },
          {
            role: "user",
            content: input
          }
        ]
      : [
          {
            role: "user",
            content: input
          }
        ]
  };
}

export function toRuntimeInput(execution: AgentExecution): AgentInputItem[] {
  if (execution.checkpoint.inputItems.length > 0) {
    return execution.checkpoint.inputItems;
  }

  throw new Error(`Agent execution ${execution.executionId} does not contain runnable input.`);
}

export function extractUsedTools(newItems: RunItem[]): ExecutionToolUse[] {
  const usedTools: ExecutionToolUse[] = [];

  for (const item of newItems) {
    if (item.type !== "tool_call_item") {
      continue;
    }

    const rawItem = item.rawItem as
      | {
          callId?: string;
          name?: string;
        }
      | undefined;
    const toolName = rawItem?.name;

    if (!toolName) {
      continue;
    }

    usedTools.push({
      name: toolName,
      callId: getRawToolCallId(rawItem) ?? null
    });
  }

  return usedTools;
}

export function parseToolArguments(argumentsText: string | undefined): Record<string, unknown> {
  if (!argumentsText) {
    return {};
  }

  try {
    const parsed = JSON.parse(argumentsText) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function getRawToolCallId(rawItem: unknown): string | undefined {
  if (!rawItem || typeof rawItem !== "object") {
    return undefined;
  }

  const candidate = rawItem as {
    callId?: unknown;
  };

  return typeof candidate.callId === "string" ? candidate.callId : undefined;
}

export async function loadThread(threadId: string, threadStore: ThreadStore): Promise<Thread> {
  const thread = await threadStore.get(threadId);

  if (thread === null) {
    throw new AgentThreadNotFoundError(threadId);
  }

  return thread;
}

export async function updateCompletedThread(
  thread: Thread,
  lastResponseId: string | null
): Promise<Thread> {
  let nextThread = thread;

  if (lastResponseId) {
    nextThread = updateThreadLastResponse(nextThread, lastResponseId);
  }

  nextThread = applyThreadMetadataPatch(nextThread, {
    threadMetadata: {
      turnCount: nextThread.threadMetadata.turnCount + 1
    }
  });

  return nextThread;
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function assertEntrypointAgentId(agentRuntime: AppAgentRuntime): string {
  const agentId = agentRuntime.getEntrypointAgentId();

  if (agentId === null) {
    throw new Error("Agent runtime does not have an entrypoint agent.");
  }

  return agentId;
}
