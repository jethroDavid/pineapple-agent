import type { ThreadStore } from "../threads/store/thread-store.js";
import type { AppAdapter } from "./app-adapter.js";
import type { AdapterPlugin } from "./adapter-plugin.js";

export interface AdapterPluginRegistry {
  listPluginIds(): string[];
  createAdapters(options: {
    threadStore: ThreadStore;
  }): AppAdapter[];
}

export function createAdapterPluginRegistry(plugins: AdapterPlugin[]): AdapterPluginRegistry {
  const pluginMap = new Map<string, AdapterPlugin>();

  for (const plugin of plugins) {
    if (pluginMap.has(plugin.id)) {
      throw new Error(`Adapter plugin ${plugin.id} is defined more than once.`);
    }

    pluginMap.set(plugin.id, plugin);
  }

  const orderedPlugins = Array.from(pluginMap.values()).sort((left, right) => {
    const orderCompare = left.startupOrder - right.startupOrder;

    if (orderCompare !== 0) {
      return orderCompare;
    }

    return left.id.localeCompare(right.id);
  });

  return {
    listPluginIds() {
      return orderedPlugins.map((plugin) => plugin.id);
    },
    createAdapters(options) {
      const adapters: AppAdapter[] = [];

      for (const plugin of orderedPlugins) {
        const adapter = plugin.create({
          threadStore: options.threadStore
        });

        if (adapter !== null) {
          adapters.push(adapter);
        }
      }

      return adapters;
    }
  };
}
