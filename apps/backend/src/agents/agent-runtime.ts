import { resolve } from "node:path";

import {
  Agent,
  MCPServerStdio,
  Runner,
  type AgentInputItem,
  type RunItem,
  type RunToolApprovalItem,
  type Tool
} from "@openai/agents";

import type { ThreadStore } from "../threads/store/thread-store.js";
import type { AgentRuntimeContext } from "./agent-runtime-context.js";
import type { LoadedAgentManifest } from "./agent-manifest.js";
import type { AgentToolsetRegistry } from "./agent-toolset-registry.js";
import { createDefaultSessionBackendRegistry } from "./session-backends/default-session-backend-registry.js";
import type { SessionBackend } from "./session-backends/session-backend.js";
import type { SessionBackendRegistry } from "./session-backends/session-backend-registry.js";
import type { AgentThreadStore } from "./store/agent-thread-store.js";
import type { SpecialistSessionStore } from "./store/specialist-session-store.js";
import {
  initializeAgentGraph,
  listAgentSummaries,
  type MCPConnectionManager
} from "./runtime/agent-runtime-setup.js";
import { executeAgentRuntimeTurn } from "./runtime/agent-runtime-turn.js";
import { trace } from "../utils/trace.js";

export interface AgentRuntimeOptions {
  definitionsDir: string;
  defaultModel: string;
  codexModel?: string;
  projectRoot?: string;
  threadStore: ThreadStore;
  agentThreadStore: AgentThreadStore;
  specialistSessionStore: SpecialistSessionStore;
  toolsetRegistry: AgentToolsetRegistry;
  sessionBackendRegistry?: SessionBackendRegistry;
}

interface AgentRunTurnOptions {
  agentId?: string;
  input: string;
  threadId?: string;
}

interface AgentRunTurnResult {
  threadId: string;
  rootAgentId: string;
  activeAgentId: string;
  activeAgentName: string;
  finalOutput: string;
  lastResponseId: string | null;
}

export interface AgentExecuteTurnOptions {
  agentId?: string;
  input?: string | AgentInputItem[];
  threadId?: string;
  serializedState?: string;
  approvalResolution?: {
    toolCallId: string;
    toolName: string;
    status: "approved" | "rejected" | "expired";
    message?: string;
  };
}

export interface AgentExecuteTurnResult extends AgentRunTurnResult {
  runState: string;
  interruptions: RunToolApprovalItem[];
  newItems: RunItem[];
  outputItems: unknown[];
}

export interface AgentSummary {
  id: string;
  name: string;
  description?: string;
  handoffDescription: string;
  handoffs: string[];
  agentTools: string[];
  entrypoint: boolean;
  toolsets: string[];
  sessionBackendKind: string | null;
}

export interface AppAgentRuntime {
  initialize(): Promise<void>;
  close(): Promise<void>;
  isReady(): boolean;
  listAgents(): AgentSummary[];
  getAgentSummary(agentId: string): AgentSummary | null;
  hasAgent(agentId: string): boolean;
  getEntrypointAgentId(): string | null;
  executeTurn(options: AgentExecuteTurnOptions): Promise<AgentExecuteTurnResult>;
  runTurn(options: AgentRunTurnOptions): Promise<AgentRunTurnResult>;
}

export function createAgentRuntime(options: AgentRuntimeOptions): AppAgentRuntime {
  let initialized = false;
  let entrypointAgentId: string | null = null;
  let manifests: LoadedAgentManifest[] = [];
  let connectionManager: MCPConnectionManager | null = null;
  const agents = new Map<string, Agent<AgentRuntimeContext>>();
  const agentIdsByInstance = new Map<Agent<AgentRuntimeContext>, string>();
  const mcpServersByAgentId = new Map<string, MCPServerStdio[]>();
  const sessionBackendsByAgentId = new Map<string, SessionBackend>();
  const localToolsByAgentId = new Map<string, Tool<AgentRuntimeContext>[]>();
  const runner = new Runner({
    workflowName: "pineapple-agent-runtime"
  });
  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  const sessionBackendRegistry =
    options.sessionBackendRegistry ?? createDefaultSessionBackendRegistry();

  return {
    async initialize() {
      trace("runtime", "agent runtime initialize start");
      const initializedGraph = await initializeAgentGraph({
        options,
        projectRoot,
        sessionBackendRegistry,
        agents,
        agentIdsByInstance,
        mcpServersByAgentId,
        sessionBackendsByAgentId,
        localToolsByAgentId
      });

      manifests = initializedGraph.manifests;
      entrypointAgentId = initializedGraph.entrypointAgentId;
      connectionManager = initializedGraph.connectionManager;
      initialized = true;
      trace("runtime", "agent runtime initialize done", {
        entrypointAgentId,
        agentCount: manifests.length
      });
    },
    async close() {
      trace("runtime", "agent runtime close start");
      initialized = false;
      agents.clear();
      agentIdsByInstance.clear();
      localToolsByAgentId.clear();
      mcpServersByAgentId.clear();

      for (const sessionBackend of sessionBackendsByAgentId.values()) {
        await sessionBackend.close();
      }

      sessionBackendsByAgentId.clear();

      if (connectionManager !== null) {
        await connectionManager.close();
        connectionManager = null;
      }

      trace("runtime", "agent runtime closed");
    },
    isReady() {
      return initialized;
    },
    listAgents() {
      return listAgentSummaries(manifests);
    },
    getAgentSummary(agentId) {
      return this.listAgents().find((agent) => agent.id === agentId) ?? null;
    },
    hasAgent(agentId) {
      return this.getAgentSummary(agentId) !== null;
    },
    getEntrypointAgentId() {
      return entrypointAgentId;
    },
    async executeTurn(optionsForTurn) {
      return await executeAgentRuntimeTurn({
        initialized,
        entrypointAgentId,
        options,
        agents,
        agentIdsByInstance,
        sessionBackendsByAgentId,
        runner,
        optionsForTurn
      });
    },
    async runTurn(optionsForTurn) {
      const result = await this.executeTurn(optionsForTurn);

      return {
        threadId: result.threadId,
        rootAgentId: result.rootAgentId,
        activeAgentId: result.activeAgentId,
        activeAgentName: result.activeAgentName,
        finalOutput: result.finalOutput,
        lastResponseId: result.lastResponseId
      };
    }
  };
}
