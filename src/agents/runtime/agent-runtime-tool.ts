import { tool, type Tool } from "@openai/agents";

import type { ToolDefinition } from "../../tools/tool-definition.js";
import type { AgentRuntimeContext } from "../agent-runtime-context.js";
import { trace, traceError } from "../../utils/trace.js";

export function toAgentFunctionTool(toolDefinition: ToolDefinition): Tool<AgentRuntimeContext> {
  return tool({
    name: toolDefinition.name,
    description: toolDefinition.description ?? `Call ${toolDefinition.name}.`,
    parameters: toolDefinition.inputSchema as never,
    needsApproval: toolDefinition.approvalRequired,
    execute: async (input, runContext) => {
      trace(`tool:${toolDefinition.name}`, "input", {
        input,
        threadId: runContext?.context?.threadId ?? null
      });

      let parsedInput: unknown;
      try {
        parsedInput = toolDefinition.inputSchema.parse(input);
      } catch (error) {
        traceError(`tool:${toolDefinition.name}`, "input parse failed", error, {
          input
        });
        throw error;
      }

      let output: unknown;
      try {
        output = await toolDefinition.execute(parsedInput as never, {
          threadId: runContext?.context?.threadId
        });
      } catch (error) {
        traceError(`tool:${toolDefinition.name}`, "execute failed", error, {
          parsedInput
        });
        throw error;
      }

      const parsedOutput = toolDefinition.outputSchema.parse(output);
      trace(`tool:${toolDefinition.name}`, "output", parsedOutput);
      return parsedOutput;
    }
  });
}
