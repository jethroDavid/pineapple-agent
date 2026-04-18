import { tool, type Tool } from "@openai/agents";

import type { ToolDefinition } from "../../tools/tool-definition.js";
import type { AgentRuntimeContext } from "../agent-runtime-context.js";

export function toAgentFunctionTool(toolDefinition: ToolDefinition): Tool<AgentRuntimeContext> {
  return tool({
    name: toolDefinition.name,
    description: toolDefinition.description ?? `Call ${toolDefinition.name}.`,
    parameters: toolDefinition.inputSchema as never,
    needsApproval: toolDefinition.approvalRequired,
    execute: async (input) => {
      const parsedInput = toolDefinition.inputSchema.parse(input);
      const output = await toolDefinition.execute(parsedInput);
      return toolDefinition.outputSchema.parse(output);
    }
  });
}
