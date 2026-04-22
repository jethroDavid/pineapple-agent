import { Agent, RunState } from "@openai/agents";

import type { AgentRuntimeContext } from "./agent-runtime-context.js";

interface ApprovalResolution {
  toolCallId: string;
  toolName: string;
  status: "approved" | "rejected" | "expired";
  message?: string;
}

export async function restoreRunState(options: {
  serializedState: string;
  rootAgent: Agent<AgentRuntimeContext>;
  approvalResolution?: ApprovalResolution;
}): Promise<RunState<AgentRuntimeContext, Agent<AgentRuntimeContext>>> {
  const state = await RunState.fromString<AgentRuntimeContext, Agent<AgentRuntimeContext>>(
    options.rootAgent,
    options.serializedState
  );

  if (options.approvalResolution === undefined) {
    return state;
  }

  const interruption = state
    .getInterruptions()
    .find(
      (item) =>
        getToolCallId(item.rawItem) === options.approvalResolution?.toolCallId &&
        item.name === options.approvalResolution?.toolName
    );

  if (!interruption) {
    throw new Error(
      `Run state does not contain approval item ${options.approvalResolution.toolName}:${options.approvalResolution.toolCallId}.`
    );
  }

  if (options.approvalResolution.status === "approved") {
    state.approve(interruption);
    return state;
  }

  state.reject(interruption, {
    message: options.approvalResolution.message
  });

  return state;
}

function getToolCallId(rawItem: unknown): string | undefined {
  if (!rawItem || typeof rawItem !== "object") {
    return undefined;
  }

  const candidate = rawItem as {
    callId?: unknown;
  };

  return typeof candidate.callId === "string" ? candidate.callId : undefined;
}
