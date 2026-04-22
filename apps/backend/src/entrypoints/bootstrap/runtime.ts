import type { AppAdapter, AppAdapterInitContext } from "../../adapters/app-adapter.js";
import { createAgentRuntime, type AppAgentRuntime } from "../../agents/agent-runtime.js";
import { createAppServices } from "./services.js";
import { env } from "../../config/env.js";
import { PineappleDaemon } from "../../execution/queue/pineapple-daemon.js";
import {
  createAppExecutionService,
  type AppExecutionService
} from "../../execution/pipeline/service.js";
import type { ExecutionTurnResult } from "../../execution/execution-contracts.js";
import { trace } from "../../utils/trace.js";

interface AppRuntime {
  adapters: AppAdapter[];
  daemon: PineappleDaemon<unknown>;
  execution: AppExecutionService;
  agentRuntime: AppAgentRuntime | null;
  initializeAdapters(context: AppAdapterInitContext): Promise<void>;
  initializeAgentRuntime(): Promise<void>;
  closeAgentRuntime(): Promise<void>;
  recoverActiveRuns(): Promise<ExecutionTurnResult[]>;
}

export function createAppRuntime(): AppRuntime | null {
  const services = createAppServices();

  if (services === null) {
    trace("startup", "runtime disabled: missing OPENAI_API_KEY or OPENAI_MODEL");
    return null;
  }

  const adapters = services.adapters;
  const daemon = new PineappleDaemon(async () => undefined);
  const agentRuntime =
    env.OPENAI_API_KEY && env.OPENAI_MODEL
      ? createAgentRuntime({
          definitionsDir: env.PINEAPPLE_AGENTS_DIR ?? ".pineapple/agents",
          defaultModel: env.OPENAI_MODEL,
          codexModel: env.CODEX_MODEL ?? undefined,
          threadStore: services.threadStore,
          agentThreadStore: services.agentThreadStore,
          specialistSessionStore: services.specialistSessionStore,
          toolsetRegistry: services.agentToolsetRegistry
        })
      : null;
  const execution = createAppExecutionService({
    daemon,
    agentRuntime,
    threadStore: services.threadStore,
    agentExecutionStore: services.agentExecutionStore,
    agentExecutionDecisionStore: services.agentExecutionDecisionStore,
    triggerPromptEnrichers: services.triggerPromptEnrichers
  });

  return {
    adapters,
    daemon,
    execution,
    agentRuntime,
    async initializeAdapters(context) {
      trace("startup", "initialize adapters start", {
        count: adapters.length
      });
      for (const adapter of adapters) {
        trace("startup", "initialize adapter", {
          adapter: adapter.name
        });
        await adapter.initialize?.({
          ...context,
          execution
        });
      }
      trace("startup", "initialize adapters done");
    },
    async initializeAgentRuntime() {
      await agentRuntime?.initialize();
    },
    async closeAgentRuntime() {
      await agentRuntime?.close();
    },
    async recoverActiveRuns() {
      return await execution.recoverActiveRuns();
    }
  };
}
