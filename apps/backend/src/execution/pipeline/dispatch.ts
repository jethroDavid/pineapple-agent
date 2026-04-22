import type { AgentInputItem } from "@openai/agents";

import type { AppAgentRuntime } from "../../agents/agent-runtime.js";
import { AgentThreadNotFoundError } from "../../agents/errors.js";
import { parseTriggerPrompt } from "../contracts/trigger-prompt.js";
import type { TriggerEvent } from "../contracts/trigger-event.js";
import { routeTriggerEvent } from "../routing/route-trigger-event.js";
import { agentExecutionKind } from "../domain/agent-execution.js";
import type { ExecutionRequest, ExecutionTurnResult } from "../execution-contracts.js";
import type { AppExecutionServiceOptions } from "./context.js";
import { trace } from "../../utils/trace.js";
import {
  createPendingDecision,
  handleDecisionResolutionRequest,
  type DecisionResolutionRequestResult
} from "./approval.js";
import { handleRecoveryRequest } from "./recovery.js";
import { runFreshExecution } from "./runtime.js";
import { enrichTriggerPrompt } from "./trigger-prompt-enrichment.js";
import {
  assertEntrypointAgentId,
  normalizeTurnInput
} from "./shared.js";

type TriggerRequest = Extract<ExecutionRequest, { kind: "trigger" }>;
type ManualTurnRequest = Extract<ExecutionRequest, { kind: "manual_turn" }>;
type DecisionResolutionRequest = Extract<ExecutionRequest, { kind: "decision_resolution" }>;
type RecoveryRequest = Extract<ExecutionRequest, { kind: "recovery" }>;

type ExecutionRequestResult = ExecutionTurnResult | DecisionResolutionRequestResult;

export function submitExecutionRequest(input: {
  request: TriggerRequest;
  options: AppExecutionServiceOptions;
}): Promise<ExecutionTurnResult>;
export function submitExecutionRequest(input: {
  request: ManualTurnRequest;
  options: AppExecutionServiceOptions;
}): Promise<ExecutionTurnResult>;
export function submitExecutionRequest(input: {
  request: DecisionResolutionRequest;
  options: AppExecutionServiceOptions;
}): Promise<DecisionResolutionRequestResult>;
export function submitExecutionRequest(input: {
  request: RecoveryRequest;
  options: AppExecutionServiceOptions;
}): Promise<ExecutionTurnResult>;
export async function submitExecutionRequest(input: {
  request: ExecutionRequest;
  options: AppExecutionServiceOptions;
}): Promise<ExecutionRequestResult> {
  trace("execution", "submit request", {
    kind: input.request.kind
  });

  if (input.options.daemon === null) {
    throw new Error("Execution queue is not configured. Set OPENAI_API_KEY and OPENAI_MODEL first.");
  }

  return await input.options.daemon.submitJob(async () => {
    switch (input.request.kind) {
      case "trigger":
        return await dispatchExecutionRequest(input.request, input.options);
      case "manual_turn":
        return await dispatchExecutionRequest(input.request, input.options);
      case "decision_resolution":
        return await dispatchExecutionRequest(input.request, input.options);
      case "recovery":
        return await dispatchExecutionRequest(input.request, input.options);
    }
  });
}

export function dispatchExecutionRequest(
  request: TriggerRequest,
  options: AppExecutionServiceOptions
): Promise<ExecutionTurnResult>;
export function dispatchExecutionRequest(
  request: ManualTurnRequest,
  options: AppExecutionServiceOptions
): Promise<ExecutionTurnResult>;
export function dispatchExecutionRequest(
  request: DecisionResolutionRequest,
  options: AppExecutionServiceOptions
): Promise<DecisionResolutionRequestResult>;
export function dispatchExecutionRequest(
  request: RecoveryRequest,
  options: AppExecutionServiceOptions
): Promise<ExecutionTurnResult>;
export async function dispatchExecutionRequest(
  request: ExecutionRequest,
  options: AppExecutionServiceOptions
): Promise<ExecutionRequestResult> {
  trace("execution", "dispatch request", {
    kind: request.kind
  });

  const agentRuntime = options.agentRuntime;

  if (agentRuntime === null || agentRuntime === undefined) {
    throw new Error("Agent runtime is not configured. Set OPENAI_API_KEY and OPENAI_MODEL first.");
  }

  switch (request.kind) {
    case "trigger":
      return await handleTriggerRequest(request.triggerEvent, options, agentRuntime);
    case "manual_turn":
      return await handleManualTurnRequest(request, options, agentRuntime);
    case "decision_resolution":
      return await handleDecisionResolutionRequest(request, options);
    case "recovery":
      return await handleRecoveryRequest(request.executionId, options);
  }
}

async function handleTriggerRequest(
  triggerEvent: TriggerEvent,
  options: AppExecutionServiceOptions,
  agentRuntime: AppAgentRuntime
): Promise<ExecutionTurnResult> {
  trace("execution", "handle trigger", {
    triggerId: triggerEvent.trigger_id,
    source: triggerEvent.source.system,
    eventType: triggerEvent.source.event_type
  });

  const route = await routeTriggerEvent(triggerEvent, {
    threadStore: options.threadStore
  });
  trace("execution", "trigger routed", {
    triggerId: triggerEvent.trigger_id,
    routeKind: route.kind,
    threadId: route.thread.threadId
  });
  const prompt = enrichTriggerPrompt({
    triggerEvent,
    thread: route.thread,
    prompt: parseTriggerPrompt(triggerEvent.payload),
    enrichers: options.triggerPromptEnrichers
  });

  const normalizedInput = normalizeTurnInput(
    Array.isArray(prompt.input) ? (prompt.input as AgentInputItem[]) : prompt.input,
    prompt.instructions
  );
  const entrypointAgentId = prompt.agent_id ?? assertEntrypointAgentId(agentRuntime);
  const execution = await options.agentExecutionStore.create({
    threadId: route.thread.threadId,
    kind: agentExecutionKind.trigger,
    triggerId: triggerEvent.trigger_id,
    entrypointAgentId,
    activeAgentId: entrypointAgentId,
    checkpoint: {
      ...normalizedInput,
      routeKind: route.kind,
      runState: null
    }
  });
  trace("execution", "execution created", {
    executionId: execution.executionId,
    kind: execution.kind,
    threadId: execution.threadId,
    entrypointAgentId: execution.entrypointAgentId
  });

  return await runFreshExecution({
    execution,
    thread: route.thread,
    route,
    options,
    createPendingDecision
  });
}

async function handleManualTurnRequest(
  request: ManualTurnRequest,
  options: AppExecutionServiceOptions,
  agentRuntime: AppAgentRuntime
): Promise<ExecutionTurnResult> {
  trace("execution", "handle manual turn", {
    threadId: request.threadId ?? null,
    agentId: request.agentId ?? null
  });

  const thread =
    request.threadId === undefined
      ? await options.threadStore.create({})
      : await options.threadStore.get(request.threadId);

  if (thread === null) {
    throw new AgentThreadNotFoundError(request.threadId!);
  }

  const normalizedInput = normalizeTurnInput(request.input);
  const requestedAgentId =
    request.agentId ?? assertEntrypointAgentId(agentRuntime);
  const execution = await options.agentExecutionStore.create({
    threadId: thread.threadId,
    kind: agentExecutionKind.manualTurn,
    entrypointAgentId: requestedAgentId,
    requestedAgentId,
    activeAgentId: requestedAgentId,
    checkpoint: {
      ...normalizedInput,
      routeKind: null,
      runState: null
    }
  });
  trace("execution", "execution created", {
    executionId: execution.executionId,
    kind: execution.kind,
    threadId: execution.threadId,
    entrypointAgentId: execution.entrypointAgentId
  });

  return await runFreshExecution({
    execution,
    thread,
    route: null,
    options,
    createPendingDecision
  });
}
