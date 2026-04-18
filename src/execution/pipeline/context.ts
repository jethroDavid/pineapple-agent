import type { AppAgentRuntime } from "../../agents/agent-runtime.js";
import type { ThreadStore } from "../../threads/store/thread-store.js";
import type { PineappleDaemon } from "../queue/pineapple-daemon.js";
import type { AgentExecutionDecisionStore } from "../store/agent-execution-decision-store.js";
import type { AgentExecutionStore } from "../store/agent-execution-store.js";

export interface AppExecutionServiceOptions {
  daemon: PineappleDaemon<unknown> | null;
  agentRuntime?: AppAgentRuntime | null;
  threadStore: ThreadStore;
  agentExecutionStore: AgentExecutionStore;
  agentExecutionDecisionStore: AgentExecutionDecisionStore;
}
