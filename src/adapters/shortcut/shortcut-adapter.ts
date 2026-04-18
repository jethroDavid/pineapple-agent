import type { FastifyBaseLogger, FastifyInstance, FastifyRequest } from "fastify";

import type { AppAdapter, AppAdapterInitContext } from "../app-adapter.js";
import type { AppExecutionService } from "../../execution/pipeline/service.js";
import {
  ShortcutApiError,
  type ShortcutClientLike,
  type ShortcutWebhookIntegration
} from "./shortcut-client.js";
import { createShortcutCreateStoryTool } from "./shortcut-create-story-tool.js";
import { createShortcutPostCommentTool } from "./shortcut-post-comment-tool.js";
import { createShortcutUpdateStoryTool } from "./shortcut-update-story-tool.js";
import {
  createShortcutTriggerEvent,
  getShortcutWebhookSignature,
  normalizeShortcutWebhookDelivery,
  resolveShortcutComment,
  shortcutIgnoredReason,
  shortcutWebhookPath,
  shouldIgnoreShortcutStoryComment,
  verifyShortcutWebhookSignature
} from "./shortcut-webhook.js";
import {
  assertValidHttpsWebhookBaseUrl,
  withTrailingSlash
} from "../shared/webhook-url.js";

interface ShortcutAdapterOptions {
  apiToken?: string | null;
  webhookSecret?: string | null;
  webhookBaseUrl?: string | null;
  webhookIntegrationId?: string | null;
  agentName?: string | null;
  client?: ShortcutClientLike;
}

interface NormalizedShortcutAdapterOptions {
  apiToken: string;
  webhook: ShortcutWebhookConfig | null;
  webhookIntegrationId: string | null;
  agentName: string;
  client?: ShortcutClientLike;
}

interface ShortcutWebhookConfig {
  secret: string;
  baseUrl: string;
}

export function createShortcutAdapter(options: ShortcutAdapterOptions): AppAdapter | null {
  const normalizedOptions = normalizeShortcutAdapterOptions(options);

  if (normalizedOptions === null) {
    return null;
  }

  const client = getShortcutClient(normalizedOptions);

  return {
    name: "shortcut",
    getTools() {
      return [
        createShortcutCreateStoryTool({
          client
        }),
        createShortcutPostCommentTool({
          agentName: normalizedOptions.agentName,
          client
        }),
        createShortcutUpdateStoryTool({
          client
        })
      ];
    },
    registerRoutes(app, context) {
      if (normalizedOptions.webhook === null) {
        return;
      }

      registerShortcutWebhookRoute(app, {
        agentName: normalizedOptions.agentName,
        client,
        execution: context.execution,
        webhookSecret: normalizedOptions.webhook.secret
      });
    },
    async initialize(context) {
      await initializeShortcutAdapter(normalizedOptions, client, context);
    }
  };
}

function normalizeShortcutAdapterOptions(
  options: ShortcutAdapterOptions
): NormalizedShortcutAdapterOptions | null {
  const apiToken = options.apiToken?.trim() ?? null;
  const webhookSecret = options.webhookSecret?.trim() ?? null;
  const webhookBaseUrl = options.webhookBaseUrl?.trim() ?? null;
  const webhookIntegrationId = options.webhookIntegrationId?.trim() ?? null;
  const agentName = options.agentName?.trim() || "pineapple";
  const hasWebhookConfig = webhookSecret !== null || webhookBaseUrl !== null;
  const hasAnyConfig = apiToken !== null || hasWebhookConfig || options.client !== undefined;

  if (!hasAnyConfig) {
    return null;
  }

  if (apiToken === null) {
    throw new Error("Shortcut adapter requires SHORTCUT_API_TOKEN when enabled.");
  }

  if ((webhookSecret === null) !== (webhookBaseUrl === null)) {
    throw new Error(
      "Shortcut webhook mode requires both SHORTCUT_WEBHOOK_SECRET and SHORTCUT_WEBHOOK_BASE_URL."
    );
  }

  if (webhookSecret !== null && webhookIntegrationId === null) {
    throw new Error(
      "Shortcut webhook mode requires SHORTCUT_WEBHOOK_INTEGRATION_ID."
    );
  }

  if (webhookBaseUrl !== null) {
    assertValidHttpsWebhookBaseUrl(webhookBaseUrl, "SHORTCUT_WEBHOOK_BASE_URL");
  }

  return {
    apiToken,
    webhook:
      webhookSecret === null || webhookBaseUrl === null
        ? null
        : {
            secret: webhookSecret,
            baseUrl: webhookBaseUrl
          },
    webhookIntegrationId,
    agentName,
    client: options.client
  };
}

function getShortcutClient(
  options: NormalizedShortcutAdapterOptions
): ShortcutClientLike {
  if (options.client === undefined) {
    throw new Error("Shortcut adapter requires a prebuilt client dependency.");
  }

  return options.client;
}

function registerShortcutWebhookRoute(
  app: FastifyInstance,
  options: {
    agentName: string;
    client: ShortcutClientLike;
    execution: AppExecutionService | null;
    webhookSecret: string;
  }
): void {
  app.post(shortcutWebhookPath, (request, reply) => {
    const rawBody = getRawRequestBody(request);
    const signature = getShortcutWebhookSignature(request.headers);

    if (
      rawBody === null ||
      !verifyShortcutWebhookSignature({
        rawBody,
        secret: options.webhookSecret,
        signature
      })
    ) {
      return reply.code(401).send({
        error: "Invalid Shortcut webhook signature."
      });
    }

    reply.code(200).send({
      ok: true
    });

    void processShortcutWebhookDelivery(request.body, {
      agentName: options.agentName,
      client: options.client,
      execution: options.execution,
      logger: request.log
    });
  });
}

async function processShortcutWebhookDelivery(
  body: unknown,
  options: {
    agentName: string;
    client: ShortcutClientLike;
    execution: AppExecutionService | null;
    logger: FastifyBaseLogger;
  }
): Promise<void> {
  try {
    const delivery = normalizeShortcutWebhookDelivery(body);

    if (delivery.kind === "ignored") {
      options.logger.info(
        {
          deliveryId: delivery.deliveryId,
          reason: delivery.reason
        },
        "Shortcut webhook delivery ignored."
      );
      return;
    }

    const [story, workflows] = await Promise.all([
      options.client.getStory(delivery.storyPublicId),
      options.client.listWorkflows()
    ]);
    const comment = resolveShortcutComment(story.comments, delivery.commentId);

    if (shouldIgnoreShortcutStoryComment(comment, options.agentName)) {
      options.logger.info(
        {
          deliveryId: delivery.deliveryId,
          reason: shortcutIgnoredReason.selfAuthoredComment,
          storyPublicId: delivery.storyPublicId
        },
        "Shortcut webhook delivery ignored."
      );
      return;
    }

    if (options.execution === null) {
      throw new Error("Execution service is not configured. Set OPENAI_API_KEY and OPENAI_MODEL first.");
    }

    const triggerEvent = createShortcutTriggerEvent({
      delivery,
      story,
      workflows,
      agentName: options.agentName
    });

    options.execution.enqueueTrigger(triggerEvent, (error) => {
      options.logger.error(
        {
          ...(error instanceof Error ? { err: error } : { error }),
          deliveryId: delivery.deliveryId,
          storyPublicId: delivery.storyPublicId,
          triggerId: triggerEvent.trigger_id
        },
        "Shortcut webhook trigger failed."
      );
    });
  } catch (error) {
    options.logger.error(
      {
        ...(error instanceof Error ? { err: error } : { error })
      },
      "Shortcut webhook background processing failed."
    );
  }
}

function getRawRequestBody(request: FastifyRequest): Buffer | null {
  const value = (request as FastifyRequest & { rawBody?: Buffer }).rawBody;
  return Buffer.isBuffer(value) ? value : null;
}

async function initializeShortcutAdapter(
  options: NormalizedShortcutAdapterOptions,
  client: ShortcutClientLike,
  context: AppAdapterInitContext
): Promise<void> {
  if (options.webhook === null) {
    context.logger.info("Shortcut adapter initialized in outbound-only mode.");
    return;
  }

  const desiredWebhookUrl = createDesiredShortcutWebhookUrl(options.webhook.baseUrl);
  const integration = await getConfiguredShortcutWebhookIntegration({
    client,
    desiredWebhookUrl,
    integrationPublicId: options.webhookIntegrationId ?? ""
  });

  context.logger.info(
    {
      integrationPublicId: integration.id,
      url: desiredWebhookUrl
    },
    "Shortcut webhook ensured."
  );
}

function createDesiredShortcutWebhookUrl(webhookBaseUrl: string): string {
  return new URL(shortcutWebhookPath, withTrailingSlash(webhookBaseUrl)).toString();
}

async function getConfiguredShortcutWebhookIntegration(options: {
  client: ShortcutClientLike;
  desiredWebhookUrl: string;
  integrationPublicId: string;
}): Promise<ShortcutWebhookIntegration> {
  let integration: ShortcutWebhookIntegration;

  try {
    integration = await options.client.getWebhookIntegration(options.integrationPublicId);
  } catch (error) {
    if (error instanceof ShortcutApiError && error.statusCode === 404) {
      throw new Error(
        `Configured Shortcut webhook integration ${options.integrationPublicId} was not found.`
      );
    }

    throw error;
  }

  if (!shortcutWebhookIntegrationMatches(integration, options.desiredWebhookUrl)) {
    throw new Error(
      `Configured Shortcut webhook integration ${options.integrationPublicId} does not match the desired webhook configuration.`
    );
  }

  return integration;
}

function shortcutWebhookIntegrationMatches(
  integration: ShortcutWebhookIntegration,
  desiredWebhookUrl: string
): boolean {
  return (
    integration.webhook_url === desiredWebhookUrl &&
    integration.disabled !== true &&
    integration.has_secret === true
  );
}

export { shortcutWebhookPath };
