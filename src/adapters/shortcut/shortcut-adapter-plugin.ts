import { env } from "../../config/env.js";
import type { AdapterPlugin } from "../adapter-plugin.js";
import { ShortcutClient, type ShortcutClientLike } from "./shortcut-client.js";
import { createShortcutAdapter } from "./shortcut-adapter.js";

interface ShortcutAdapterPluginDependencies {
  client?: ShortcutClientLike;
}

export const shortcutAdapterPlugin: AdapterPlugin = {
  id: "shortcut",
  startupOrder: 100,
  create(context) {
    const dependencies = resolveShortcutDependencies(context.dependencies);

    return createShortcutAdapter({
      apiToken: env.SHORTCUT_API_TOKEN ?? null,
      webhookSecret: env.SHORTCUT_WEBHOOK_SECRET ?? null,
      webhookBaseUrl: env.SHORTCUT_WEBHOOK_BASE_URL ?? null,
      webhookIntegrationId: env.SHORTCUT_WEBHOOK_INTEGRATION_ID ?? null,
      agentName: env.SHORTCUT_AGENT_NAME ?? null,
      client: createShortcutClient(dependencies)
    });
  }
};

function resolveShortcutDependencies(input: unknown): ShortcutAdapterPluginDependencies {
  if (input === undefined) {
    return {};
  }

  if (typeof input !== "object" || input === null) {
    throw new Error("Shortcut adapter plugin dependencies must be an object.");
  }

  return input as ShortcutAdapterPluginDependencies;
}

function createShortcutClient(
  dependencies: ShortcutAdapterPluginDependencies
): ShortcutClientLike | undefined {
  if (env.SHORTCUT_API_TOKEN === undefined) {
    return undefined;
  }

  return (
    dependencies.client ??
    new ShortcutClient({
      apiToken: env.SHORTCUT_API_TOKEN
    })
  );
}
