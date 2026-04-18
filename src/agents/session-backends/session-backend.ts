import type { Tool } from "@openai/agents";

import type { LoadedAgentManifest } from "../agent-manifest.js";
import type { AgentRuntimeContext } from "../agent-runtime-context.js";
import type { SpecialistSession } from "../domain/specialist-session.js";
import type { UpsertSpecialistSessionInput } from "../store/specialist-session-store.js";

export interface SessionBackend {
  kind: string;
  initialize(): Promise<void>;
  close(): Promise<void>;
  createTools(): Tool<AgentRuntimeContext>[];
  buildInstructions(session: SpecialistSession | null): string | null;
  extractSessionUpdate(outputItems: unknown[]): Omit<UpsertSpecialistSessionInput, "threadId"> | null;
}

export interface SessionBackendFactory {
  kind: string;
  getOwnedServerIds(manifest: LoadedAgentManifest): string[];
  create(options: {
    manifest: LoadedAgentManifest;
    projectRoot: string;
  }): SessionBackend;
}
