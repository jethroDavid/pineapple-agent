import type {
  AgentExecutionDecision,
  AgentExecutionDecisionResolution
} from "../domain/agent-execution-decision.js";
import { agentExecutionStatus } from "../domain/agent-execution.js";
import type { TriggerEvent } from "../contracts/trigger-event.js";
import type { PineappleDaemonStatus } from "../queue/pineapple-daemon.js";
import type { AppExecutionServiceOptions } from "./context.js";
import { trace } from "../../utils/trace.js";
import {
  dispatchExecutionRequest,
  submitExecutionRequest
} from "./dispatch.js";
import type { ExecutionTurnResult } from "../execution-contracts.js";

export interface AppExecutionService {
  getQueueStatus(): PineappleDaemonStatus | null;
  canResolveDecisions(): boolean;
  submitTrigger(triggerEvent: TriggerEvent): Promise<ExecutionTurnResult>;
  enqueueTrigger(
    triggerEvent: TriggerEvent,
    onError?: (error: unknown) => void,
    onSuccess?: (result: ExecutionTurnResult) => void
  ): void;
  runTurn(options: {
    threadId?: string;
    agentId?: string;
    input: string;
  }): Promise<ExecutionTurnResult>;
  resolveDecision(
    decisionId: string,
    resolution: AgentExecutionDecisionResolution
  ): Promise<{
    decision: AgentExecutionDecision;
    result: ExecutionTurnResult;
  }>;
  recoverActiveRuns(): Promise<ExecutionTurnResult[]>;
}

type CreateAppExecutionServiceOptions = AppExecutionServiceOptions;

export function createAppExecutionService(
  options: CreateAppExecutionServiceOptions
): AppExecutionService {
  return {
    getQueueStatus() {
      return options.daemon?.getStatus() ?? null;
    },
    canResolveDecisions() {
      return (
        options.agentRuntime !== null &&
        options.agentRuntime !== undefined &&
        options.daemon !== null
      );
    },
    async submitTrigger(triggerEvent) {
      trace("execution", "service submitTrigger", {
        triggerId: triggerEvent.trigger_id
      });
      return await submitExecutionRequest({
        request: {
          kind: "trigger",
          triggerEvent
        },
        options
      });
    },
    enqueueTrigger(triggerEvent, onError, onSuccess) {
      if (options.daemon === null) {
        throw new Error("Execution queue is not configured. Set OPENAI_API_KEY and OPENAI_MODEL first.");
      }

      trace("execution", "service enqueueTrigger", {
        triggerId: triggerEvent.trigger_id
      });
      options.daemon.submitJob(() =>
        dispatchExecutionRequest(
          {
            kind: "trigger",
            triggerEvent
          },
          options
        )
      ).then((result) => {
        onSuccess?.(result);
      }).catch((error) => {
        onError?.(error);
      });
    },
    async runTurn(runOptions) {
      trace("execution", "service runTurn", {
        threadId: runOptions.threadId ?? null,
        agentId: runOptions.agentId ?? null
      });
      return await submitExecutionRequest({
        request: {
          kind: "manual_turn",
          threadId: runOptions.threadId,
          agentId: runOptions.agentId,
          input: runOptions.input
        },
        options
      });
    },
    async resolveDecision(decisionId, resolution) {
      trace("approval", "service resolveDecision", {
        decisionId,
        resolution
      });
      return await submitExecutionRequest({
        request: {
          kind: "decision_resolution",
          decisionId,
          resolution
        },
        options
      });
    },
    async recoverActiveRuns() {
      const recoverable = await options.agentExecutionStore.listByStatuses([
        agentExecutionStatus.queued,
        agentExecutionStatus.running
      ]);
      const results: ExecutionTurnResult[] = [];
      trace("recovery", "service recoverActiveRuns", {
        count: recoverable.length
      });

      for (const execution of recoverable) {
        results.push(
          await submitExecutionRequest({
            request: {
              kind: "recovery",
              executionId: execution.executionId
            },
            options
          })
        );
      }

      return results;
    }
  };
}
