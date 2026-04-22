import type { LoadedAgentManifest } from "../agent-manifest.js";

import type { SessionBackend, SessionBackendFactory } from "./session-backend.js";

export interface SessionBackendRegistry {
  getOwnedServerIds(manifest: LoadedAgentManifest): string[];
  createBackend(options: {
    manifest: LoadedAgentManifest;
    projectRoot: string;
  }): SessionBackend | null;
}

export function createSessionBackendRegistry(
  factories: SessionBackendFactory[]
): SessionBackendRegistry {
  const factoriesByKind = new Map<string, SessionBackendFactory>();

  for (const factory of factories) {
    if (factoriesByKind.has(factory.kind)) {
      throw new Error(`Session backend factory ${factory.kind} is defined more than once.`);
    }

    factoriesByKind.set(factory.kind, factory);
  }

  return {
    getOwnedServerIds(manifest) {
      const factory = getFactory(factoriesByKind, manifest);
      return factory ? factory.getOwnedServerIds(manifest) : [];
    },
    createBackend(options) {
      const factory = getFactory(factoriesByKind, options.manifest);
      return factory ? factory.create(options) : null;
    }
  };
}

function getFactory(
  factoriesByKind: Map<string, SessionBackendFactory>,
  manifest: LoadedAgentManifest
): SessionBackendFactory | null {
  if (!manifest.sessionBackend) {
    return null;
  }

  const factory = factoriesByKind.get(manifest.sessionBackend.kind);

  if (!factory) {
    throw new Error(
      `Agent ${manifest.id} references unsupported session backend kind ${manifest.sessionBackend.kind}.`
    );
  }

  return factory;
}
