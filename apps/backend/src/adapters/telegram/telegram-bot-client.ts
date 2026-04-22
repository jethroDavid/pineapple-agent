const telegramApiBaseUrl = "https://api.telegram.org";

interface TelegramBotClientOptions {
  botToken: string;
  fetchImplementation?: typeof fetch;
}

interface TelegramSendMessageRequest {
  chat_id: string;
  text: string;
  message_thread_id?: number;
}

interface TelegramSendMessageResult {
  message_id: number;
  date: number;
  chat: {
    id: number;
    type: string;
  };
}

interface TelegramWebhookInfoResult {
  url: string;
  has_custom_certificate?: boolean;
  pending_update_count: number;
  ip_address?: string;
  last_error_date?: number;
  last_error_message?: string;
  last_synchronization_error_date?: number;
  max_connections?: number;
  allowed_updates?: string[];
}

export interface TelegramSetWebhookRequest {
  url: string;
  secret_token: string;
  allowed_updates?: string[];
  max_connections?: number;
}

interface TelegramDeleteWebhookRequest {
  drop_pending_updates?: boolean;
}

interface TelegramGetUpdatesRequest {
  offset?: number;
  timeout?: number;
  allowed_updates?: string[];
}

export interface TelegramBotCommand {
  command: string;
  description: string;
}

export interface TelegramBotClientLike {
  sendMessage(request: TelegramSendMessageRequest): Promise<TelegramSendMessageResult>;
  getUpdates(request?: TelegramGetUpdatesRequest): Promise<unknown[]>;
  getMyCommands(): Promise<TelegramBotCommand[]>;
  getWebhookInfo(): Promise<TelegramWebhookInfoResult>;
  deleteWebhook(request?: TelegramDeleteWebhookRequest): Promise<true>;
  setMyCommands(commands: TelegramBotCommand[]): Promise<true>;
  setWebhook(request: TelegramSetWebhookRequest): Promise<true>;
}

interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

export class TelegramBotClient implements TelegramBotClientLike {
  private readonly botToken: string;
  private readonly fetchImplementation: typeof fetch;

  constructor(options: TelegramBotClientOptions) {
    this.botToken = options.botToken;
    this.fetchImplementation = options.fetchImplementation ?? fetch;
  }

  async sendMessage(
    request: TelegramSendMessageRequest
  ): Promise<TelegramSendMessageResult> {
    return await this.callApi<TelegramSendMessageResult>("sendMessage", request);
  }

  async getMyCommands(): Promise<TelegramBotCommand[]> {
    return await this.callApi<TelegramBotCommand[]>("getMyCommands");
  }

  async getUpdates(request: TelegramGetUpdatesRequest = {}): Promise<unknown[]> {
    return await this.callApi<unknown[]>("getUpdates", request);
  }

  async getWebhookInfo(): Promise<TelegramWebhookInfoResult> {
    return await this.callApi<TelegramWebhookInfoResult>("getWebhookInfo");
  }

  async deleteWebhook(request: TelegramDeleteWebhookRequest = {}): Promise<true> {
    return await this.callApi<true>("deleteWebhook", request);
  }

  async setMyCommands(commands: TelegramBotCommand[]): Promise<true> {
    return await this.callApi<true>("setMyCommands", {
      commands
    });
  }

  async setWebhook(request: TelegramSetWebhookRequest): Promise<true> {
    return await this.callApi<true>("setWebhook", request);
  }

  private async callApi<T>(method: string, payload?: unknown): Promise<T> {
    const response = await this.fetchImplementation(
      `${telegramApiBaseUrl}/bot${this.botToken}/${method}`,
      {
        method: payload === undefined ? "GET" : "POST",
        headers:
          payload === undefined
            ? undefined
            : {
                "content-type": "application/json"
              },
        body: payload === undefined ? undefined : JSON.stringify(payload)
      }
    );

    const body = (await response.json()) as TelegramApiResponse<T>;

    if (!response.ok || body.ok !== true || body.result === undefined) {
      throw new Error(body.description ?? `Telegram ${method} failed.`);
    }

    return body.result;
  }
}
