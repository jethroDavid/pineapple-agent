import type { ThreadStore } from "../threads/store/thread-store.js";
import type { AppAdapter } from "./app-adapter.js";
import type { AdapterPlugin } from "./adapter-plugin.js";
import { createAdapterPluginRegistry } from "./adapter-plugin-registry.js";
import { createDefaultAdapterPlugins } from "./default-adapter-plugins.js";

export interface CreateAppAdaptersOptions {
  threadStore: ThreadStore;
  plugins?: AdapterPlugin[];
}

export function createAppAdapters(options: CreateAppAdaptersOptions): AppAdapter[] {
  const registry = createAdapterPluginRegistry(options.plugins ?? createDefaultAdapterPlugins());

  return registry.createAdapters({
    threadStore: options.threadStore
  });
}
