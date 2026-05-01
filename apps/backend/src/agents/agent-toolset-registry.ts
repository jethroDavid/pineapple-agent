import type { ToolDefinition } from "../tools/tool-definition.js";

export interface AgentToolsetRegistry {
  listToolsetIds(): string[];
  isUnavailable(toolsetId: string): boolean;
  resolve(toolsetIds: string[]): ToolDefinition[];
}

export interface AgentToolGroupEntry {
  id: string;
  tools: ToolDefinition[];
  availability: "available" | "unavailable";
}

export function createAgentToolsetRegistry(toolsets: AgentToolGroupEntry[]): AgentToolsetRegistry {
  const entries = new Map(toolsets.map((toolset) => [toolset.id, toolset]));

  return {
    listToolsetIds() {
      return Array.from(entries.keys()).sort((left, right) => left.localeCompare(right));
    },
    isUnavailable(toolsetId) {
      return entries.get(toolsetId)?.availability === "unavailable";
    },
    resolve(toolsetIds) {
      const seen = new Set<string>();
      const resolved: ToolDefinition[] = [];

      for (const toolsetId of toolsetIds) {
        const toolset = entries.get(toolsetId);

        if (!toolset) {
          throw new Error(`Unknown agent toolset ${toolsetId}.`);
        }

        for (const tool of toolset.tools) {
          if (seen.has(tool.name)) {
            continue;
          }

          seen.add(tool.name);
          resolved.push(tool);
        }
      }

      return resolved;
    }
  };
}
