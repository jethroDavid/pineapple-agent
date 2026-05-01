import type { FastifyInstance } from "fastify";
import { describe, expect, it, vi } from "vitest";

import type { AppAdapter, AppAdapterRouteContext } from "../../src/adapters/app-adapter.js";
import type { AdapterPlugin } from "../../src/adapters/adapter-plugin.js";
import { createAdapterPluginRegistry } from "../../src/adapters/adapter-plugin-registry.js";
import { createAppAdapters } from "../../src/adapters/create-app-adapters.js";
import { InMemoryThreadStore } from "../support/in-memory-thread-store.js";

describe("createAdapterPluginRegistry", () => {
  it("orders plugin startup deterministically", () => {
    const creationOrder: string[] = [];
    const registry = createAdapterPluginRegistry([
      createFakePlugin({
        id: "telegram",
        startupOrder: 200,
        create() {
          creationOrder.push("telegram");
          return createFakeAdapter("telegram");
        }
      }),
      createFakePlugin({
        id: "shortcut",
        startupOrder: 100,
        create() {
          creationOrder.push("shortcut");
          return createFakeAdapter("shortcut");
        }
      }),
      createFakePlugin({
        id: "alpha",
        startupOrder: 100,
        create() {
          creationOrder.push("alpha");
          return createFakeAdapter("alpha");
        }
      })
    ]);

    const adapters = registry.createAdapters({
      threadStore: new InMemoryThreadStore()
    });

    expect(registry.listPluginIds()).toEqual(["alpha", "shortcut", "telegram"]);
    expect(creationOrder).toEqual(["alpha", "shortcut", "telegram"]);
    expect(adapters.map((adapter) => adapter.name)).toEqual([
      "alpha",
      "shortcut",
      "telegram"
    ]);
  });

  it("creates plugins with app-owned context only", () => {
    const createPlugin = vi.fn(() => createFakeAdapter("shortcut"));
    const registry = createAdapterPluginRegistry([
      createFakePlugin({
        id: "shortcut",
        startupOrder: 100,
        create: createPlugin
      })
    ]);
    const threadStore = new InMemoryThreadStore();

    registry.createAdapters({
      threadStore
    });

    expect(createPlugin).toHaveBeenCalledWith({
      threadStore
    });
  });

  it("fails fast when a plugin throws during adapter creation", () => {
    const registry = createAdapterPluginRegistry([
      createFakePlugin({
        id: "shortcut",
        startupOrder: 100,
        create() {
          throw new Error("adapter creation failed");
        }
      })
    ]);

    expect(() =>
      registry.createAdapters({
        threadStore: new InMemoryThreadStore()
      })
    ).toThrow("adapter creation failed");
  });

  it("rejects duplicate plugin ids", () => {
    expect(() =>
      createAdapterPluginRegistry([
        createFakePlugin({
          id: "shortcut",
          startupOrder: 100,
          create() {
            return null;
          }
        }),
        createFakePlugin({
          id: "shortcut",
          startupOrder: 200,
          create() {
            return null;
          }
        })
      ])
    ).toThrow(/defined more than once/);
  });
});

describe("createAppAdapters", () => {
  it("assembles adapters via the plugin registry", () => {
    const adapters = createAppAdapters({
      threadStore: new InMemoryThreadStore(),
      plugins: [
        createFakePlugin({
          id: "b",
          startupOrder: 200,
          create() {
            return createFakeAdapter("b");
          }
        }),
        createFakePlugin({
          id: "a",
          startupOrder: 100,
          create() {
            return createFakeAdapter("a");
          }
        }),
        createFakePlugin({
          id: "disabled",
          startupOrder: 300,
          create() {
            return null;
          }
        })
      ]
    });

    expect(adapters.map((adapter) => adapter.name)).toEqual(["a", "b"]);
  });
});

function createFakePlugin(plugin: AdapterPlugin): AdapterPlugin {
  return plugin;
}

function createFakeAdapter(name: string): AppAdapter {
  return {
    name,
    getTools() {
      return [];
    },
    registerRoutes(_app: FastifyInstance, _context: AppAdapterRouteContext) {}
  };
}
