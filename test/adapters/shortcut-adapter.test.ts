import Fastify from "fastify";
import type { FastifyBaseLogger } from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createShortcutAdapter,
  shortcutWebhookPath
} from "../../src/adapters/shortcut/shortcut-adapter.js";
import type {
  ShortcutClientLike,
  ShortcutWebhookIntegration
} from "../../src/adapters/shortcut/shortcut-client.js";

describe("createShortcutAdapter", () => {
  const apps: ReturnType<typeof Fastify>[] = [];

  afterEach(async () => {
    while (apps.length > 0) {
      const app = apps.pop();
      await app?.close();
    }
  });

  it("returns null when Shortcut is not configured", () => {
    expect(createShortcutAdapter({})).toBeNull();
  });

  it("fails fast when webhook settings are incomplete", () => {
    expect(() =>
      createShortcutAdapter({
        apiToken: "shortcut-token",
        webhookSecret: "shortcut-secret"
      })
    ).toThrow(/SHORTCUT_WEBHOOK_SECRET and SHORTCUT_WEBHOOK_BASE_URL/);

    expect(() =>
      createShortcutAdapter({
        apiToken: "shortcut-token",
        webhookBaseUrl: "https://pineapple.example.ts.net"
      })
    ).toThrow(/SHORTCUT_WEBHOOK_SECRET and SHORTCUT_WEBHOOK_BASE_URL/);
  });

  it("fails fast when the webhook base url is not absolute https", () => {
    expect(() =>
      createShortcutAdapter({
        apiToken: "shortcut-token",
        webhookSecret: "shortcut-secret",
        webhookBaseUrl: "http://pineapple.example.ts.net",
        webhookIntegrationId: "500107362",
        client: createFakeShortcutClient()
      })
    ).toThrow(/must use https/);
  });

  it("fails fast when webhook mode is missing an integration id", () => {
    expect(() =>
      createShortcutAdapter({
        apiToken: "shortcut-token",
        webhookSecret: "shortcut-secret",
        webhookBaseUrl: "https://pineapple.example.ts.net",
        client: createFakeShortcutClient()
      })
    ).toThrow(/SHORTCUT_WEBHOOK_INTEGRATION_ID/);
  });

  it("registers Shortcut tools when the api token is configured", () => {
    const adapter = createShortcutAdapter({
      apiToken: "shortcut-token",
      client: createFakeShortcutClient()
    });

    expect(adapter?.getTools().map((tool) => tool.name)).toEqual([
      "shortcut_create_story",
      "shortcut_post_comment",
      "shortcut_update_story"
    ]);
  });

  it("does not expose the webhook route in outbound-only mode", async () => {
    const adapter = createShortcutAdapter({
      apiToken: "shortcut-token",
      client: createFakeShortcutClient()
    });
    const app = Fastify();
    apps.push(app);
    adapter!.registerRoutes(app, {
      execution: null
    });

    const response = await app.inject({
      method: "POST",
      url: shortcutWebhookPath,
      payload: {}
    });

    expect(response.statusCode).toBe(404);
  });

  it("logs the desired webhook url on startup when the configured integration matches", async () => {
    const client = createFakeShortcutClient({
      fetchedIntegration: {
        id: "500107362",
        webhook_url: "https://pineapple.example.ts.net/adapters/shortcut/webhook",
        disabled: false,
        has_secret: true
      }
    });
    const adapter = createShortcutAdapter({
      apiToken: "shortcut-token",
      webhookSecret: "shortcut-secret",
      webhookBaseUrl: "https://pineapple.example.ts.net",
      webhookIntegrationId: "500107362",
      client
    });
    const logger = createFakeLogger();

    await adapter!.initialize?.({
      logger,
      execution: null
    });

    expect(logger.info).toHaveBeenCalledWith(
      {
        integrationPublicId: "500107362",
        url: "https://pineapple.example.ts.net/adapters/shortcut/webhook"
      },
      "Shortcut webhook ensured."
    );
    expect(client.getWebhookIntegration).toHaveBeenCalledWith("500107362");
    expect(client.createWebhookIntegration).not.toHaveBeenCalled();
    expect(client.deleteWebhookIntegration).not.toHaveBeenCalled();
  });

  it("fails when the configured integration drifts from the desired webhook config", async () => {
    const client = createFakeShortcutClient({
      fetchedIntegration: {
        id: "500107362",
        webhook_url: "https://old.example.ts.net/adapters/shortcut/webhook",
        disabled: false,
        has_secret: true
      }
    });
    const adapter = createShortcutAdapter({
      apiToken: "shortcut-token",
      webhookSecret: "shortcut-secret",
      webhookBaseUrl: "https://pineapple.example.ts.net",
      webhookIntegrationId: "500107362",
      client
    });

    await expect(
      adapter!.initialize?.({
        logger: createFakeLogger(),
        execution: null
      })
    ).rejects.toThrow(/does not match the desired webhook configuration/);
  });

  it("uses the configured integration id", async () => {
    const client = createFakeShortcutClient({
      fetchedIntegration: {
        id: "500107400",
        webhook_url: "https://pineapple.example.ts.net/adapters/shortcut/webhook",
        disabled: false,
        has_secret: true
      }
    });
    const adapter = createShortcutAdapter({
      apiToken: "shortcut-token",
      webhookSecret: "shortcut-secret",
      webhookBaseUrl: "https://pineapple.example.ts.net",
      webhookIntegrationId: "500107400",
      client
    });

    await adapter!.initialize?.({
      logger: createFakeLogger(),
      execution: null
    });

    expect(client.getWebhookIntegration).toHaveBeenCalledWith("500107400");
    expect(client.createWebhookIntegration).not.toHaveBeenCalled();
  });

  it("fails when the configured integration is missing remotely", async () => {
    const client = createFakeShortcutClient();
    client.getWebhookIntegration.mockRejectedValueOnce(
      new Error("Configured Shortcut webhook integration 500107362 was not found.")
    );
    const adapter = createShortcutAdapter({
      apiToken: "shortcut-token",
      webhookSecret: "shortcut-secret",
      webhookBaseUrl: "https://pineapple.example.ts.net",
      webhookIntegrationId: "500107362",
      client
    });

    await expect(
      adapter!.initialize?.({
        logger: createFakeLogger(),
        execution: null
      })
    ).rejects.toThrow(/was not found/);
  });
});

function createFakeShortcutClient(options: {
  createdIntegration?: ShortcutWebhookIntegration;
  fetchedIntegration?: ShortcutWebhookIntegration;
} = {}): ShortcutClientLike & {
  createStory: ReturnType<typeof vi.fn>;
  createWebhookIntegration: ReturnType<typeof vi.fn>;
  getWebhookIntegration: ReturnType<typeof vi.fn>;
  deleteWebhookIntegration: ReturnType<typeof vi.fn>;
} {
  return {
    getStory: vi.fn(),
    listWorkflows: vi.fn(),
    createStory: vi.fn(),
    createStoryComment: vi.fn(),
    updateStory: vi.fn(),
    createWebhookIntegration: vi
      .fn()
      .mockResolvedValue(
        options.createdIntegration ?? {
          id: "500107362",
          webhook_url: "https://pineapple.example.ts.net/adapters/shortcut/webhook",
          disabled: false,
          has_secret: true
        }
      ),
    getWebhookIntegration: vi
      .fn()
      .mockResolvedValue(
        options.fetchedIntegration ?? {
          id: "500107362",
          webhook_url: "https://pineapple.example.ts.net/adapters/shortcut/webhook",
          disabled: false,
          has_secret: true
        }
      ),
    deleteWebhookIntegration: vi.fn().mockResolvedValue(undefined)
  };
}

function createFakeLogger(): FastifyBaseLogger {
  return {
    level: "info",
    silent: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    debug: vi.fn(),
    child: vi.fn()
  } as FastifyBaseLogger;
}
