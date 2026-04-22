import { codexMcpSessionBackendFactory } from "./codex-mcp-session-backend-factory.js";
import {
  createSessionBackendRegistry,
  type SessionBackendRegistry
} from "./session-backend-registry.js";

export function createDefaultSessionBackendRegistry(): SessionBackendRegistry {
  return createSessionBackendRegistry([codexMcpSessionBackendFactory]);
}
