import type { AdapterPlugin } from "./adapter-plugin.js";
import { shortcutAdapterPlugin } from "./shortcut/shortcut-adapter-plugin.js";
import { telegramAdapterPlugin } from "./telegram/telegram-adapter-plugin.js";

const defaultAdapterPlugins: AdapterPlugin[] = [shortcutAdapterPlugin, telegramAdapterPlugin];

export function createDefaultAdapterPlugins(): AdapterPlugin[] {
  return [...defaultAdapterPlugins];
}
