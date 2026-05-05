import { resolve } from "node:path";

import { createAgentRuntime } from "../../src/agents/agent-runtime.js";
import type { LoadedAgentManifest } from "../../src/agents/agent-manifest.js";
import {
  createAgentToolsetRegistry,
  type AgentToolGroupEntry
} from "../../src/agents/agent-toolset-registry.js";
import type { SessionBackend } from "../../src/agents/session-backends/session-backend.js";
import { createSessionBackendRegistry } from "../../src/agents/session-backends/session-backend-registry.js";
import type { JsonObject } from "../../src/shared/types/json.js";
import type { ThreadStore } from "../../src/threads/store/thread-store.js";
import type { ToolDefinition } from "../../src/tools/tool-definition.js";
import {
  InMemoryAgentThreadStore,
  InMemorySpecialistSessionStore
} from "../support/in-memory-agent-runtime-stores.js";
import { InMemoryThreadStore } from "../support/in-memory-thread-store.js";

export interface RecordedToolCall {
  name: string;
  arguments: JsonObject;
}

export interface EvalRuntimeToolsetOptions {
  assistantAudioBridgeTools?: ToolDefinition[];
  cronTools?: ToolDefinition[];
  threadStore?: ThreadStore;
  telegramTools?: ToolDefinition[];
  shortcutTools?: ToolDefinition[];
}

export interface RouteableEvalOutput {
  activeAgentId: string;
  toolCalls: Pick<RecordedToolCall, "name">[];
}

export function shouldRunOnlineEvals(): boolean {
  return parseBooleanEnv(process.env.EVAL_OPENAI_ENABLED) ?? false;
}

export function createEvalRuntime(options: EvalRuntimeToolsetOptions = {}) {
  return createAgentRuntime({
    definitionsDir: resolve(".pineapple/agents"),
    projectRoot: resolve("../.."),
    defaultModel: process.env.EVAL_OPENAI_MODEL ?? "gpt-5-mini",
    codexModel: process.env.EVAL_OPENAI_CODEX_MODEL ?? process.env.EVAL_OPENAI_MODEL ?? "gpt-5-mini",
    threadStore: options.threadStore ?? new InMemoryThreadStore(),
    agentThreadStore: new InMemoryAgentThreadStore(),
    specialistSessionStore: new InMemorySpecialistSessionStore(),
    toolsetRegistry: createAgentToolsetRegistry(createEvalToolsets(options)),
    sessionBackendRegistry: createSessionBackendRegistry([fakeCodexSessionBackendFactory])
  });
}

export function didRouteTo(output: RouteableEvalOutput, expectedAgentId: string): boolean {
  return (
    output.activeAgentId === expectedAgentId ||
    output.toolCalls.some((call) => call.name === `ask_${expectedAgentId}`)
  );
}

export function findMatchingToolCall(
  output: { toolCalls: RecordedToolCall[] },
  toolName: string
): RecordedToolCall | undefined {
  return output.toolCalls.find((call) => call.name === toolName);
}

export function mergeRecordedToolCalls(
  recordedToolCalls: RecordedToolCall[],
  newItems: unknown[]
): RecordedToolCall[] {
  return [
    ...recordedToolCalls,
    ...extractToolCalls(newItems).filter(
      (call) =>
        !recordedToolCalls.some(
          (recorded) =>
            recorded.name === call.name &&
            JSON.stringify(recorded.arguments) === JSON.stringify(call.arguments)
        )
    )
  ];
}

export function extractToolCalls(items: unknown[]): RecordedToolCall[] {
  return items
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }

      const candidate = item as {
        rawItem?: {
          name?: unknown;
          arguments?: unknown;
        };
        name?: unknown;
        arguments?: unknown;
      };
      const name =
        typeof candidate.name === "string"
          ? candidate.name
          : typeof candidate.rawItem?.name === "string"
            ? candidate.rawItem.name
            : null;
      const args = candidate.arguments ?? candidate.rawItem?.arguments;

      if (name === null) {
        return null;
      }

      return {
        name,
        arguments: parseToolArguments(args)
      };
    })
    .filter((call): call is RecordedToolCall => call !== null);
}

function createEvalToolsets(options: EvalRuntimeToolsetOptions): AgentToolGroupEntry[] {
  return [
    {
      id: "assistant_audio_bridge",
      tools: options.assistantAudioBridgeTools ?? [],
      availability: "available"
    },
    { id: "cron", tools: options.cronTools ?? [], availability: "available" },
    { id: "telegram", tools: options.telegramTools ?? [], availability: "available" },
    { id: "shortcut", tools: options.shortcutTools ?? [], availability: "available" }
  ];
}

function parseToolArguments(value: unknown): JsonObject {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as JsonObject;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as JsonObject)
        : {};
    } catch {
      return {};
    }
  }

  return {};
}

function parseBooleanEnv(value: string | undefined): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === "") {
    return undefined;
  }

  if (["true", "1", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["false", "0", "no", "off"].includes(normalized)) {
    return false;
  }

  return undefined;
}

const fakeCodexSessionBackendFactory = {
  kind: "codex_mcp",
  getOwnedServerIds(manifest: LoadedAgentManifest): string[] {
    return manifest.sessionBackend?.kind === "codex_mcp" ? [manifest.sessionBackend.serverId] : [];
  },
  create(): SessionBackend {
    return new FakeCodexSessionBackend();
  }
};

class FakeCodexSessionBackend implements SessionBackend {
  readonly kind = "codex_mcp";

  async initialize() {}

  async close() {}

  createTools() {
    return [];
  }

  buildInstructions() {
    return null;
  }

  extractSessionUpdate() {
    return null;
  }
}
