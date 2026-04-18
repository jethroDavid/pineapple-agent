import { z } from "zod";

import {
  getShortcutIntegrationIdFromLocation,
  readShortcutResponseBody
} from "./shortcut-client-helpers.js";
import {
  shortcutStoryCommentSchema,
  shortcutStorySchema,
  shortcutWebhookIntegrationSchema,
  shortcutWorkflowSchema,
  type ShortcutStory,
  type ShortcutStoryComment,
  type ShortcutWebhookIntegration,
  type ShortcutWorkflow
} from "./shortcut-client-schemas.js";

const shortcutApiBaseUrl = "https://api.app.shortcut.com/api/v3";

interface ShortcutClientOptions {
  apiToken: string;
  apiBaseUrl?: string;
  fetchImplementation?: typeof fetch;
}

interface ShortcutUpdateStoryRequest {
  description?: string;
  name?: string;
  story_type?: "feature" | "bug" | "chore";
  workflow_state_id?: string;
}

interface ShortcutCreateStoryCommentRequest {
  text: string;
}

interface ShortcutCreateStoryRequest {
  description?: string;
  name: string;
  story_type?: "feature" | "bug" | "chore";
  workflow_state_id: string;
}

interface ShortcutCreateWebhookIntegrationRequest {
  secret?: string;
  webhook_url: string;
}

export interface ShortcutClientLike {
  getStory(storyPublicId: string): Promise<ShortcutStory>;
  listWorkflows(): Promise<ShortcutWorkflow[]>;
  createStory(request: ShortcutCreateStoryRequest): Promise<ShortcutStory>;
  createStoryComment(
    storyPublicId: string,
    request: ShortcutCreateStoryCommentRequest
  ): Promise<ShortcutStoryComment>;
  updateStory(storyPublicId: string, request: ShortcutUpdateStoryRequest): Promise<ShortcutStory>;
  createWebhookIntegration(
    request: ShortcutCreateWebhookIntegrationRequest
  ): Promise<ShortcutWebhookIntegration>;
  getWebhookIntegration(integrationPublicId: string): Promise<ShortcutWebhookIntegration>;
  deleteWebhookIntegration(integrationPublicId: string): Promise<void>;
}

export class ShortcutApiError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "ShortcutApiError";
    this.statusCode = statusCode;
  }
}

export class ShortcutClient implements ShortcutClientLike {
  private readonly apiToken: string;
  private readonly apiBaseUrl: string;
  private readonly fetchImplementation: typeof fetch;

  constructor(options: ShortcutClientOptions) {
    this.apiToken = options.apiToken;
    this.apiBaseUrl = options.apiBaseUrl ?? shortcutApiBaseUrl;
    this.fetchImplementation = options.fetchImplementation ?? fetch;
  }

  async getStory(storyPublicId: string): Promise<ShortcutStory> {
    return shortcutStorySchema.parse(
      await this.callApi(`/stories/${encodeURIComponent(storyPublicId)}`)
    );
  }

  async listWorkflows(): Promise<ShortcutWorkflow[]> {
    return z.array(shortcutWorkflowSchema).parse(await this.callApi("/workflows"));
  }

  async createStoryComment(
    storyPublicId: string,
    request: ShortcutCreateStoryCommentRequest
  ): Promise<ShortcutStoryComment> {
    return shortcutStoryCommentSchema.parse(
      await this.callApi(`/stories/${encodeURIComponent(storyPublicId)}/comments`, {
        method: "POST",
        body: JSON.stringify(request)
      })
    );
  }

  async createStory(request: ShortcutCreateStoryRequest): Promise<ShortcutStory> {
    return shortcutStorySchema.parse(
      await this.callApi("/stories", {
        method: "POST",
        body: JSON.stringify({
          ...request,
          workflow_state_id: Number(request.workflow_state_id)
        })
      })
    );
  }

  async updateStory(
    storyPublicId: string,
    request: ShortcutUpdateStoryRequest
  ): Promise<ShortcutStory> {
    return shortcutStorySchema.parse(
      await this.callApi(`/stories/${encodeURIComponent(storyPublicId)}`, {
        method: "PUT",
        body: JSON.stringify({
          ...request,
          ...(request.workflow_state_id === undefined
            ? {}
            : {
                workflow_state_id: Number(request.workflow_state_id)
              })
        })
      })
    );
  }

  async createWebhookIntegration(
    request: ShortcutCreateWebhookIntegrationRequest
  ): Promise<ShortcutWebhookIntegration> {
    const response = await this.requestApi("/integrations/webhook", {
      method: "POST",
      body: JSON.stringify(request)
    });
    const rawBody = await readShortcutResponseBody(response);
    const location = response.headers.get("location");

    if (rawBody.trim().length > 0) {
      return shortcutWebhookIntegrationSchema.parse(JSON.parse(rawBody));
    }

    const integrationPublicId = getShortcutIntegrationIdFromLocation(location);

    if (integrationPublicId === null) {
      throw new Error(
        "Shortcut did not return a webhook integration id after creation."
      );
    }

    return await this.getWebhookIntegration(integrationPublicId);
  }

  async getWebhookIntegration(
    integrationPublicId: string
  ): Promise<ShortcutWebhookIntegration> {
    return shortcutWebhookIntegrationSchema.parse(
      await this.callApi(`/integrations/webhook/${encodeURIComponent(integrationPublicId)}`)
    );
  }

  async deleteWebhookIntegration(integrationPublicId: string): Promise<void> {
    await this.requestApi(`/integrations/webhook/${encodeURIComponent(integrationPublicId)}`, {
      method: "DELETE"
    });
  }

  private async callApi(pathname: string, init: RequestInit = {}): Promise<unknown> {
    const response = await this.requestApi(pathname, init);
    const rawBody = await readShortcutResponseBody(response);

    if (rawBody.trim().length === 0) {
      throw new Error(`Shortcut API returned an empty response body for ${pathname}.`);
    }

    return JSON.parse(rawBody);
  }

  private async requestApi(pathname: string, init: RequestInit = {}): Promise<Response> {
    const response = await this.fetchImplementation(`${this.apiBaseUrl}${pathname}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        "Shortcut-Token": this.apiToken,
        ...(init.headers ?? {})
      }
    });

    if (response.ok) {
      return response;
    }

    const rawBody = await readShortcutResponseBody(response);
    let message = `Shortcut API request failed with status ${response.status}.`;

    if (rawBody.trim().length > 0) {
      try {
        const errorBody = JSON.parse(rawBody) as { message?: string };
        message = errorBody.message ?? message;
      } catch {
        // Ignore JSON parsing failure and keep the generic HTTP status message.
      }
    }

    throw new ShortcutApiError(message, response.status);
  }
}
