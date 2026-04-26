import { describe, expect, it } from "vitest";

import { CodexMcpProvider } from "../../src/agents/providers/codex-mcp-provider.js";

describe("CodexMcpProvider", () => {
  const provider = new CodexMcpProvider({
    manifest: {
      id: "codex",
      name: "Codex Specialist",
      handoffDescription: "Handles coding work.",
      instructionsFile: "./prompts/codex.md",
      instructions: "Base instructions",
      manifestPath: "/tmp/codex.json",
      instructionsPath: "/tmp/codex.md",
      mcpServers: [],
      toolsets: [],
      sessionBackend: {
        kind: "codex_mcp",
        serverId: "codex_mcp",
        startToolName: "codex",
        replyToolName: "codex-reply"
      },
      handoffs: [],
      agentTools: [],
      entrypoint: false
    },
    server: {
      id: "codex_mcp",
      transport: "stdio",
      command: "codex",
      args: ["mcp-server"],
      cwd: ".",
      env: {}
    },
    sessionBackend: {
      kind: "codex_mcp",
      serverId: "codex_mcp",
      startToolName: "codex",
      replyToolName: "codex-reply"
    }
  });

  it("builds continuation instructions from a persisted Codex thread", () => {
    const instructions = provider.buildInstructions({
      specialistSessionId: crypto.randomUUID(),
      threadId: crypto.randomUUID(),
      agentId: "codex",
      provider: "codex_mcp",
      providerThreadId: "codex-thread-1",
      state: {},
      createdAt: new Date(),
      updatedAt: new Date()
    });

    expect(instructions).toContain("codex-thread-1");
    expect(instructions).toContain("codex-reply");
  });

  it("extracts the Codex thread id from persisted tool output provider data", () => {
    const update = provider.extractSessionUpdate([
      {
        type: "function_call_result",
        name: "codex",
        callId: "call-1",
        status: "completed",
        output: [
          {
            type: "input_text",
            text: "summary",
            providerData: {
              codex: {
                threadId: "codex-thread-2",
                content: "summary"
              }
            }
          }
        ]
      }
    ]);

    expect(update).toEqual({
      agentId: "codex",
      provider: "codex_mcp",
      providerThreadId: "codex-thread-2",
      state: {
        threadId: "codex-thread-2",
        content: "summary"
      }
    });
  });
});
