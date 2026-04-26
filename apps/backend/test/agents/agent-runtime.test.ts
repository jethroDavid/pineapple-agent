import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { createAgentRuntime } from "../../src/agents/agent-runtime.js";
import { createAgentToolsetRegistry } from "../../src/agents/agent-toolset-registry.js";
import {
  createSessionBackendRegistry
} from "../../src/agents/session-backends/session-backend-registry.js";
import type { SessionBackend } from "../../src/agents/session-backends/session-backend.js";
import { InMemoryThreadStore } from "../support/in-memory-thread-store.js";
import {
  InMemoryAgentThreadStore,
  InMemorySpecialistSessionStore
} from "../support/in-memory-agent-runtime-stores.js";

describe("createAgentRuntime", () => {
  it("initializes and lists agents when no session backend is configured", async () => {
    const definitionsDir = await createDefinitionsDir({
      includeCodexBackend: false
    });

    const runtime = createRuntime({
      definitionsDir,
      sessionBackendRegistry: createSessionBackendRegistry([])
    });

    await runtime.initialize();

    expect(runtime.isReady()).toBe(true);
    expect(runtime.getEntrypointAgentId()).toBe("root_manager");
    expect(runtime.listAgents()).toEqual([
      {
        id: "codex",
        name: "Codex",
        description: "Specialist agent.",
        handoffDescription: "Handles coding work.",
        handoffs: [],
        agentTools: [],
        entrypoint: false,
        toolsets: [],
        sessionBackendKind: null
      },
      {
        id: "root_manager",
        name: "Root Manager",
        description: "Routes work.",
        handoffDescription: "Routes tasks to specialists.",
        handoffs: ["codex"],
        agentTools: ["codex"],
        entrypoint: true,
        toolsets: [],
        sessionBackendKind: null
      }
    ]);

    await runtime.close();
  });

  it("initializes and closes codex backend instances through the backend registry", async () => {
    const definitionsDir = await createDefinitionsDir({
      includeCodexBackend: true
    });
    const createdBackends: FakeSessionBackend[] = [];
    const sessionBackendRegistry = createSessionBackendRegistry([
      {
        kind: "codex_mcp",
        getOwnedServerIds(manifest) {
          if (manifest.sessionBackend?.kind !== "codex_mcp") {
            throw new Error("Expected codex_mcp backend config.");
          }

          return [manifest.sessionBackend.serverId];
        },
        create(options) {
          if (options.manifest.sessionBackend?.kind !== "codex_mcp") {
            throw new Error("Expected codex_mcp backend config.");
          }

          const backend = new FakeSessionBackend(options.manifest.sessionBackend.kind);
          createdBackends.push(backend);
          return backend;
        }
      }
    ]);
    const runtime = createRuntime({
      definitionsDir,
      sessionBackendRegistry
    });

    await runtime.initialize();

    expect(runtime.listAgents().find((agent) => agent.id === "codex")?.sessionBackendKind).toBe(
      "codex_mcp"
    );
    expect(createdBackends).toHaveLength(1);
    expect(createdBackends[0]?.initializeCalls).toBe(1);

    await runtime.close();

    expect(createdBackends[0]?.closeCalls).toBe(1);
  });
});

class FakeSessionBackend implements SessionBackend {
  initializeCalls = 0;
  closeCalls = 0;

  constructor(readonly kind: string) {}

  async initialize() {
    this.initializeCalls += 1;
  }

  async close() {
    this.closeCalls += 1;
  }

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

function createRuntime(options: {
  definitionsDir: string;
  sessionBackendRegistry: ReturnType<typeof createSessionBackendRegistry>;
}) {
  return createAgentRuntime({
    definitionsDir: options.definitionsDir,
    defaultModel: "gpt-5-mini",
    codexModel: "gpt-5-mini",
    threadStore: new InMemoryThreadStore(),
    agentThreadStore: new InMemoryAgentThreadStore(),
    specialistSessionStore: new InMemorySpecialistSessionStore(),
    toolsetRegistry: createAgentToolsetRegistry({}),
    sessionBackendRegistry: options.sessionBackendRegistry
  });
}

async function createDefinitionsDir(options: { includeCodexBackend: boolean }): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "pineapple-runtime-agents-"));
  const promptsDir = join(root, "prompts");

  await mkdir(promptsDir);
  await writeFile(join(promptsDir, "root.md"), "Root instructions\n", "utf8");
  await writeFile(join(promptsDir, "codex.md"), "Codex instructions\n", "utf8");

  await writeFile(
    join(root, "root-manager.json"),
    JSON.stringify({
      id: "root_manager",
      name: "Root Manager",
      description: "Routes work.",
      handoffDescription: "Routes tasks to specialists.",
      instructionsFile: "./prompts/root.md",
      handoffs: ["codex"],
      agentTools: ["codex"],
      entrypoint: true
    }),
    "utf8"
  );

  await writeFile(
    join(root, "codex.json"),
    JSON.stringify({
      id: "codex",
      name: "Codex",
      description: "Specialist agent.",
      handoffDescription: "Handles coding work.",
      instructionsFile: "./prompts/codex.md",
      ...(options.includeCodexBackend
        ? {
            sessionBackend: {
              kind: "codex_mcp",
              serverId: "codex_mcp"
            },
            mcpServers: [
              {
                id: "codex_mcp",
                transport: "stdio",
                command: "codex",
                args: ["mcp-server"]
              }
            ]
          }
        : {})
    }),
    "utf8"
  );

  return root;
}
