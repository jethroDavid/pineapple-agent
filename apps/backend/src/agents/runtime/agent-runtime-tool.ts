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

      const turnContext = {
        threadId: runContext?.context?.threadId ?? null,
        sideEffects: runContext?.context?.turnSideEffects
      };
      const policyOutput = applyBeforeExecuteTurnPolicy(
        toolDefinition,
        parsedInput,
        turnContext
      );

      if (policyOutput !== null) {
        return policyOutput;
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
      recordAfterExecuteTurnPolicy(toolDefinition, turnContext.sideEffects);
      trace(`tool:${toolDefinition.name}`, "output", parsedOutput);
      return parsedOutput;
    }
  });
}

interface RuntimeToolTurnContext {
  threadId: string | null;
  sideEffects?: Set<string>;
}

function applyBeforeExecuteTurnPolicy(
  toolDefinition: ToolDefinition,
  parsedInput: unknown,
  context: RuntimeToolTurnContext
): unknown | null {
  const sideEffects = context.sideEffects;
  const turnPolicy = toolDefinition.turnPolicy;

  if (sideEffects === undefined || turnPolicy === undefined) {
    return null;
  }

  const blockingMarker = turnPolicy.blockedByMarkers?.markers.find((marker) =>
    sideEffects.has(marker)
  );

  if (blockingMarker !== undefined) {
    trace(`tool:${toolDefinition.name}`, "blocked by turn marker", {
      threadId: context.threadId,
      marker: blockingMarker
    });
    throw new Error(turnPolicy.blockedByMarkers!.message);
  }

  if (
    turnPolicy.onlyOncePerTurn !== undefined &&
    sideEffects.has(turnPolicy.onlyOncePerTurn.marker)
  ) {
    const output = turnPolicy.onlyOncePerTurn.createDuplicateOutput(parsedInput as never);
    trace(`tool:${toolDefinition.name}`, "duplicate skipped", {
      threadId: context.threadId
    });
    return toolDefinition.outputSchema.parse(output);
  }

  return null;
}

function recordAfterExecuteTurnPolicy(
  toolDefinition: ToolDefinition,
  sideEffects: Set<string> | undefined
): void {
  const turnPolicy = toolDefinition.turnPolicy;

  if (sideEffects === undefined || turnPolicy === undefined) {
    return;
  }

  if (turnPolicy.recordMarker !== undefined) {
    sideEffects.add(turnPolicy.recordMarker);
  }

  if (turnPolicy.onlyOncePerTurn !== undefined) {
    sideEffects.add(turnPolicy.onlyOncePerTurn.marker);
  }
}
