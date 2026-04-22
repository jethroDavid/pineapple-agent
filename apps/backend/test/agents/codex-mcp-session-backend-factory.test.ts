import { describe, expect, it } from "vitest";

import type { LoadedAgentManifest } from "../../src/agents/agent-manifest.js";
import { codexMcpSessionBackendFactory } from "../../src/agents/session-backends/codex-mcp-session-backend-factory.js";

describe("codexMcpSessionBackendFactory", () => {
  it("returns the backend-owned server id", () => {
    const manifest = createCodexManifest({
      mcpServers: [
        {
          id: "codex_mcp",
          transport: "stdio",
          command: "codex",
          args: ["mcp-server"],
          env: {},
          cwd: "."
        }
      ]
    });

    expect(codexMcpSessionBackendFactory.getOwnedServerIds(manifest)).toEqual(["codex_mcp"]);
  });

  it("throws when the configured backend server is missing", () => {
    const manifest = createCodexManifest({
      mcpServers: []
    });

    expect(() =>
      codexMcpSessionBackendFactory.create({
        manifest,
        projectRoot: process.cwd()
      })
    ).toThrow("references unknown session backend server codex_mcp");
  });

  it("creates a codex backend when the configured server exists", () => {
    const manifest = createCodexManifest({
      mcpServers: [
        {
          id: "codex_mcp",
          transport: "stdio",
          command: "codex",
          args: ["mcp-server"],
          env: {},
          cwd: "."
        }
      ]
    });

    const backend = codexMcpSessionBackendFactory.create({
      manifest,
      projectRoot: process.cwd()
    });

    expect(backend.kind).toBe("codex_mcp");
  });
});

function createCodexManifest(overrides: {
  mcpServers: LoadedAgentManifest["mcpServers"];
}): LoadedAgentManifest {
  return {
    id: "codex",
    name: "Codex",
    description: "Specialist",
    handoffDescription: "Handles coding work.",
    instructionsFile: "./prompts/codex.md",
    instructionsPath: "/tmp/codex.md",
    instructions: "Base instructions",
    manifestPath: "/tmp/codex.json",
    modelPreset: "codex",
    toolsets: [],
    handoffs: [],
    entrypoint: false,
    sessionBackend: {
      kind: "codex_mcp",
      serverId: "codex_mcp",
      startToolName: "codex",
      replyToolName: "codex-reply"
    },
    mcpServers: overrides.mcpServers
  };
}
