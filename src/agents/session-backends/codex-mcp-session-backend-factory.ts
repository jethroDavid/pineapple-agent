import { resolve } from "node:path";

import type {
  CodexMcpSessionBackendManifest,
  LoadedAgentManifest,
  StdioMcpServerManifest
} from "../agent-manifest.js";
import { CodexMcpProvider } from "../providers/codex-mcp-provider.js";

import type { SessionBackendFactory } from "./session-backend.js";

const CODEX_MCP_BACKEND_KIND = "codex_mcp";

export const codexMcpSessionBackendFactory: SessionBackendFactory = {
  kind: CODEX_MCP_BACKEND_KIND,
  getOwnedServerIds(manifest) {
    const backend = getCodexBackend(manifest);
    return [backend.serverId];
  },
  create(options) {
    const backend = getCodexBackend(options.manifest);
    const server = resolveServer(options.manifest, backend.serverId);

    return new CodexMcpProvider({
      manifest: options.manifest,
      sessionBackend: backend,
      server: {
        ...server,
        cwd: resolve(options.projectRoot, server.cwd ?? ".")
      }
    });
  }
};

function getCodexBackend(manifest: LoadedAgentManifest): CodexMcpSessionBackendManifest {
  if (manifest.sessionBackend?.kind !== CODEX_MCP_BACKEND_KIND) {
    throw new Error(`Agent ${manifest.id} is not configured for ${CODEX_MCP_BACKEND_KIND}.`);
  }

  return manifest.sessionBackend;
}

function resolveServer(
  manifest: LoadedAgentManifest,
  serverId: string
): StdioMcpServerManifest {
  const server = manifest.mcpServers.find((candidate) => candidate.id === serverId);

  if (!server) {
    throw new Error(
      `Agent ${manifest.id} references unknown session backend server ${serverId}.`
    );
  }

  return server;
}
