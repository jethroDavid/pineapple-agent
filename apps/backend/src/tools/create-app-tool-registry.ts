import type { AppAdapter } from "../adapters/app-adapter.js";
import { ToolRegistry } from "./tool-registry.js";

export function createAppToolRegistry(adapters: AppAdapter[] = []): ToolRegistry {
  const registry = new ToolRegistry([]);

  for (const adapter of adapters) {
    for (const tool of adapter.getTools()) {
      registry.register(tool);
    }
  }

  return registry;
}
