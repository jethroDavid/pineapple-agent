import type { ToolDefinition } from "../tools/tool-definition.js";

export interface AgentToolsetRegistry {
  listToolsetIds(): string[];
  resolve(toolsetIds: string[]): ToolDefinition[];
}

export function createAgentToolsetRegistry(
  toolsets: Record<string, ToolDefinition[]>
): AgentToolsetRegistry {
  const entries = new Map(Object.entries(toolsets));

  return {
    listToolsetIds() {
      return Array.from(entries.keys()).sort((left, right) => left.localeCompare(right));
    },
    resolve(toolsetIds) {
      const seen = new Set<string>();
      const resolved: ToolDefinition[] = [];

      for (const toolsetId of toolsetIds) {
        const tools = entries.get(toolsetId);

        if (!tools) {
          throw new Error(`Unknown agent toolset ${toolsetId}.`);
        }

        for (const tool of tools) {
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
