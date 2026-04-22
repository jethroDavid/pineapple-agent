import type { AppAdapter } from "../../adapters/app-adapter.js";
import {
  createAgentToolsetRegistry,
  type AgentToolsetRegistry
} from "../../agents/agent-toolset-registry.js";
import type { AgentThreadStore } from "../../agents/store/agent-thread-store.js";
import type { SpecialistSessionStore } from "../../agents/store/specialist-session-store.js";
import { createAppAdapters } from "../../adapters/create-app-adapters.js";
import { createDefaultAdapterPlugins } from "../../adapters/default-adapter-plugins.js";
import { env } from "../../config/env.js";
import type { ThreadStore } from "../../threads/store/thread-store.js";
import { ToolRegistry } from "../../tools/tool-registry.js";
import { DrizzleAgentThreadStore } from "../../db/stores/agent-thread-store.js";
import { DrizzleAgentExecutionDecisionStore } from "../../db/stores/agent-execution-decision-store.js";
import { DrizzleAgentExecutionStore } from "../../db/stores/agent-execution-store.js";
import { DrizzleSpecialistSessionStore } from "../../db/stores/specialist-session-store.js";
import { DrizzleThreadStore } from "../../db/stores/thread-store.js";
import type { AgentExecutionDecisionStore } from "../../execution/store/agent-execution-decision-store.js";
import type { AgentExecutionStore } from "../../execution/store/agent-execution-store.js";
import { trace } from "../../utils/trace.js";
import type { TriggerPromptEnricher } from "../../execution/pipeline/trigger-prompt-enrichment.js";
import type { ToolDefinition } from "../../tools/tool-definition.js";

interface AppServices {
  adapters: AppAdapter[];
  threadStore: ThreadStore;
  toolRegistry: ToolRegistry;
  agentExecutionStore: AgentExecutionStore;
  agentExecutionDecisionStore: AgentExecutionDecisionStore;
  agentThreadStore: AgentThreadStore;
  specialistSessionStore: SpecialistSessionStore;
  agentToolsetRegistry: AgentToolsetRegistry;
  triggerPromptEnrichers: TriggerPromptEnricher[];
}

export function createAppServices(): AppServices | null {
  if (!env.OPENAI_API_KEY || !env.OPENAI_MODEL) {
    trace("startup", "services disabled: missing OPENAI_API_KEY or OPENAI_MODEL");
    return null;
  }

  const threadStore = new DrizzleThreadStore();
  const agentExecutionStore = new DrizzleAgentExecutionStore();
  const agentExecutionDecisionStore = new DrizzleAgentExecutionDecisionStore();
  const agentThreadStore = new DrizzleAgentThreadStore();
  const specialistSessionStore = new DrizzleSpecialistSessionStore();
  const adapters = createAppAdapters({
    threadStore
  });
  const triggerPromptEnrichers = adapters.flatMap(
    (adapter) => adapter.getTriggerPromptEnrichers?.() ?? []
  );
  const toolsByAdapterId: Record<string, ToolDefinition[]> = Object.fromEntries(
    createDefaultAdapterPlugins().map((plugin) => [plugin.id, [] as ToolDefinition[]])
  );
  const toolRegistry = new ToolRegistry();

  for (const adapter of adapters) {
    const tools = adapter.getTools();
    toolsByAdapterId[adapter.name] = tools;

    for (const tool of tools) {
      toolRegistry.register(tool);
    }
  }

  const agentToolsetRegistry = createAgentToolsetRegistry({
    app: toolRegistry.list(),
    ...toolsByAdapterId
  });
  trace("startup", "services ready", {
    adapterCount: adapters.length,
    adapters: adapters.map((adapter) => adapter.name),
    toolCount: toolRegistry.list().length,
    toolsets: agentToolsetRegistry.listToolsetIds()
  });

  return {
    adapters,
    threadStore,
    toolRegistry,
    agentExecutionStore,
    agentExecutionDecisionStore,
    agentThreadStore,
    specialistSessionStore,
    agentToolsetRegistry,
    triggerPromptEnrichers
  };
}
