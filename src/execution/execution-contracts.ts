import type { AgentInputItem } from "@openai/agents";
import { z } from "zod";

import type { TriggerEvent } from "./contracts/trigger-event.js";
import type { Thread } from "../threads/domain/thread.js";
import type { TriggerRouteResult } from "./routing/route-trigger-event.js";
import type {
  AgentExecutionDecision,
  AgentExecutionDecisionResolution
} from "./domain/agent-execution-decision.js";
import type { AgentExecution } from "./domain/agent-execution.js";

export type ExecutionRequest =
  | {
      kind: "trigger";
      triggerEvent: TriggerEvent;
    }
  | {
      kind: "manual_turn";
      threadId?: string;
      agentId?: string;
      input: string | AgentInputItem[];
    }
  | {
      kind: "decision_resolution";
      decisionId: string;
      resolution: AgentExecutionDecisionResolution;
    }
  | {
      kind: "recovery";
      executionId: string;
    };

const executionToolUseSchema = z.object({
  name: z.string().min(1),
  callId: z.string().min(1).nullable()
});

export type ExecutionToolUse = z.infer<typeof executionToolUseSchema>;

export interface ExecutionTurnResult {
  thread: Thread;
  execution: AgentExecution;
  route: TriggerRouteResult | null;
  finalOutput: string | null;
  lastResponseId: string | null;
  activeAgentId: string;
  activeAgentName: string;
  usedTools: ExecutionToolUse[];
  pendingDecision: AgentExecutionDecision | null;
}
