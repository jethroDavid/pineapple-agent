import type { AdapterPlugin } from "./adapter-plugin.js";
import { assistantBridgeAdapterPlugin } from "./assistant-bridge/assistant-bridge-adapter-plugin.js";
import { cronAdapterPlugin } from "./cron/cron-adapter-plugin.js";
import { shortcutAdapterPlugin } from "./shortcut/shortcut-adapter-plugin.js";
import { telegramAdapterPlugin } from "./telegram/telegram-adapter-plugin.js";

const defaultAdapterPlugins: AdapterPlugin[] = [
  assistantBridgeAdapterPlugin,
  shortcutAdapterPlugin,
  cronAdapterPlugin,
  telegramAdapterPlugin
];

export function createDefaultAdapterPlugins(): AdapterPlugin[] {
  return [...defaultAdapterPlugins];
}
