import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { toAgentFunctionTool } from "../../src/agents/runtime/agent-runtime-tool.js";
import type { AgentRuntimeContext } from "../../src/agents/agent-runtime-context.js";
import type { ToolDefinition } from "../../src/tools/tool-definition.js";

type InvokableTool = {
  invoke(context: { context: AgentRuntimeContext }, input: string): Promise<unknown>;
};

describe("toAgentFunctionTool side-effect guards", () => {
  it("blocks tools when one of their blocked turn markers was recorded", async () => {
    const execute = vi.fn(async () => ({
      ok: true,
      value: "done"
    }));
    const tool = toAgentFunctionTool({
      name: "side_effect_tool",
      inputSchema: z.object({
        value: z.string()
      }),
      outputSchema: z.object({
        ok: z.literal(true),
        value: z.string()
      }),
      sideEffecting: true,
      approvalRequired: false,
      idempotent: false,
      turnPolicy: {
        blockedByMarkers: {
          markers: ["future_action_scheduled"],
          message: "Wait for the scheduled turn."
        }
      },
      execute
    } satisfies ToolDefinition);

    const result = await (tool as InvokableTool).invoke(
      createRunContext(["future_action_scheduled"]),
      JSON.stringify({
        value: "now"
      })
    );

    expect(result).toContain("Wait for the scheduled turn");
    expect(execute).not.toHaveBeenCalled();
  });

  it("skips duplicate one-per-turn tools using their declared duplicate output", async () => {
    const execute = vi.fn(async () => ({
      ok: true,
      duplicate: false
    }));
    const tool = toAgentFunctionTool({
      name: "single_send_tool",
      inputSchema: z.object({
        value: z.string()
      }),
      outputSchema: z.object({
        ok: z.literal(true),
        duplicate: z.boolean()
      }),
      sideEffecting: true,
      approvalRequired: false,
      idempotent: false,
      turnPolicy: {
        onlyOncePerTurn: {
          marker: "single_send_done",
          createDuplicateOutput() {
            return {
              ok: true,
              duplicate: true
            };
          }
        }
      },
      execute
    } satisfies ToolDefinition);

    const result = await (tool as InvokableTool).invoke(
      createRunContext(["single_send_done"]),
      JSON.stringify({
        value: "Duplicate"
      })
    );

    expect(result).toMatchObject({
      ok: true,
      duplicate: true
    });
    expect(execute).not.toHaveBeenCalled();
  });
});

function createRunContext(markers: string[]): { context: AgentRuntimeContext } {
  return {
    context: {
      threadId: "thread-1",
      specialistSessions: {},
      turnSideEffects: new Set(markers)
    }
  };
}
