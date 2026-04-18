import { resolve } from "node:path";

import {
  Agent,
  MCPServerStdio,
  connectMcpServers,
  type Tool
} from "@openai/agents";

import type { AgentRuntimeContext } from "../agent-runtime-context.js";
import type { LoadedAgentManifest } from "../agent-manifest.js";
import { interpolateEnvVariables } from "../interpolate-env-variables.js";
import { loadAgentManifests } from "../load-agent-manifests.js";
import type { SessionBackend } from "../session-backends/session-backend.js";
import type { SessionBackendRegistry } from "../session-backends/session-backend-registry.js";
import type { AgentRuntimeOptions, AgentSummary } from "../agent-runtime.js";
import { toAgentFunctionTool } from "./agent-runtime-tool.js";

export type MCPConnectionManager = Awaited<ReturnType<typeof connectMcpServers>>;

export async function initializeAgentGraph(input: {
  options: AgentRuntimeOptions;
  projectRoot: string;
  sessionBackendRegistry: SessionBackendRegistry;
  agents: Map<string, Agent<AgentRuntimeContext>>;
  agentIdsByInstance: Map<Agent<AgentRuntimeContext>, string>;
  mcpServersByAgentId: Map<string, MCPServerStdio[]>;
  sessionBackendsByAgentId: Map<string, SessionBackend>;
  localToolsByAgentId: Map<string, Tool<AgentRuntimeContext>[]>;
}): Promise<{
  manifests: LoadedAgentManifest[];
  entrypointAgentId: string | null;
  connectionManager: MCPConnectionManager | null;
}> {
  const manifests = await loadAgentManifests(resolve(input.options.definitionsDir));
  const entrypointAgentId = manifests.find((manifest) => manifest.entrypoint)?.id ?? null;

  for (const manifest of manifests) {
    const ownedServerIds = new Set(input.sessionBackendRegistry.getOwnedServerIds(manifest));
    const genericServers = manifest.mcpServers
      .filter((server) => !ownedServerIds.has(server.id))
      .map((server) => {
        const cwd = resolve(input.projectRoot, server.cwd ?? ".");

        return new MCPServerStdio({
          name: `${manifest.id}:${server.id}`,
          command: server.command,
          args: server.args,
          cwd,
          env: interpolateEnvVariables(server.env)
        });
      });

    input.mcpServersByAgentId.set(manifest.id, genericServers);

    const sessionBackend = input.sessionBackendRegistry.createBackend({
      manifest,
      projectRoot: input.projectRoot
    });

    if (sessionBackend) {
      await sessionBackend.initialize();
      input.sessionBackendsByAgentId.set(manifest.id, sessionBackend);
    }
  }

  const allGenericServers = Array.from(input.mcpServersByAgentId.values()).flat();
  const connectionManager =
    allGenericServers.length > 0 ? await connectMcpServers(allGenericServers) : null;

  const manifestMap = new Map(manifests.map((manifest) => [manifest.id, manifest]));
  const buildAgent = (agentId: string, stack = new Set<string>()): Agent<AgentRuntimeContext> => {
    const existing = input.agents.get(agentId);

    if (existing) {
      return existing;
    }

    if (stack.has(agentId)) {
      throw new Error(`Agent handoff cycle detected at ${agentId}.`);
    }

    const manifest = manifestMap.get(agentId);

    if (!manifest) {
      throw new Error(`Unknown agent ${agentId}.`);
    }

    stack.add(agentId);

    const handoffs = manifest.handoffs.map((handoffId) => buildAgent(handoffId, stack));
    const resolvedModel =
      manifest.model ??
      (manifest.modelPreset === "codex" ? input.options.codexModel : undefined) ??
      input.options.defaultModel;
    const sessionBackend = input.sessionBackendsByAgentId.get(agentId) ?? null;
    const localTools =
      input.localToolsByAgentId.get(agentId) ??
      input.options.toolsetRegistry
        .resolve(manifest.toolsets)
        .map((toolDefinition) => toAgentFunctionTool(toolDefinition));
    input.localToolsByAgentId.set(agentId, localTools);
    const agent = new Agent<AgentRuntimeContext>({
      name: manifest.name,
      instructions: (runContext) => {
        const sessionBackendInstructions = sessionBackend?.buildInstructions(
          runContext.context.specialistSessions[agentId] ?? null
        );

        return sessionBackendInstructions
          ? `${manifest.instructions}\n\n${sessionBackendInstructions}`
          : manifest.instructions;
      },
      handoffDescription: manifest.handoffDescription,
      model: resolvedModel,
      handoffs,
      tools: [...localTools, ...(sessionBackend?.createTools() ?? [])],
      mcpServers: input.mcpServersByAgentId.get(agentId) ?? []
    });

    input.agents.set(agentId, agent);
    input.agentIdsByInstance.set(agent, agentId);
    stack.delete(agentId);

    return agent;
  };

  for (const manifest of manifests) {
    buildAgent(manifest.id);
  }

  return {
    manifests,
    entrypointAgentId,
    connectionManager
  };
}

export function listAgentSummaries(manifests: LoadedAgentManifest[]): AgentSummary[] {
  return manifests.map((manifest) => ({
    id: manifest.id,
    name: manifest.name,
    description: manifest.description,
    handoffDescription: manifest.handoffDescription,
    handoffs: manifest.handoffs,
    entrypoint: manifest.entrypoint,
    toolsets: manifest.toolsets,
    sessionBackendKind: manifest.sessionBackend?.kind ?? null
  }));
}
