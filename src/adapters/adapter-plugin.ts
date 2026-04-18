import type { ThreadStore } from "../threads/store/thread-store.js";
import type { AppAdapter } from "./app-adapter.js";

export interface CreateAdapterPluginContext {
  threadStore: ThreadStore;
  dependencies?: unknown;
}

export interface AdapterPlugin {
  id: string;
  startupOrder: number;
  create(context: CreateAdapterPluginContext): AppAdapter | null;
}
