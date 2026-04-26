import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  type TelegramThreadSelectionStore
} from "../../src/adapters/telegram/telegram-thread-selection-store.js";
import {
  createTelegramAdapter,
  telegramWebhookPath
} from "../../src/adapters/telegram/telegram-adapter.js";
import type { TelegramBotClientLike } from "../../src/adapters/telegram/telegram-bot-client.js";
import { telegramWebhookSecretHeader } from "../../src/adapters/telegram/telegram-webhook.js";
import type { TriggerEvent } from "../../src/execution/contracts/trigger-event.js";
import { createThread, type NewThread, type Thread } from "../../src/threads/domain/thread.js";
import type { ThreadStore } from "../../src/threads/store/thread-store.js";
import { PineappleDaemon } from "../../src/execution/queue/pineapple-daemon.js";
import type { AppExecutionService } from "../../src/execution/pipeline/service.js";

describe("createTelegramAdapter", () => {
  const apps: ReturnType<typeof Fastify>[] = [];

  afterEach(async () => {
    while (apps.length > 0) {
      const app = apps.pop();
      await app?.close();
    }
  });

  it("returns null when Telegram is not configured", () => {
    expect(createTelegramAdapter({})).toBeNull();
  });

  it("fails fast when inbound transport settings are provided without a mode", () => {
    expect(() =>
      createTelegramAdapter({
        botToken: "bot-token",
        webhookSecret: "telegram-secret"
      })
    ).toThrow(/requires TELEGRAM_INBOUND_MODE/);
  });

  it("fails fast when explicit webhook mode is missing webhook configuration", () => {
    expect(() =>
      createTelegramAdapter({
        botToken: "bot-token",
        inboundMode: "webhook"
      })
    ).toThrow(/TELEGRAM_WEBHOOK_SECRET and TELEGRAM_WEBHOOK_BASE_URL/);
  });

  it("registers the Telegram outbound tool when a bot token is configured", () => {
    const adapter = createTelegramAdapter({
      botToken: "bot-token",
      client: createFakeTelegramBotClient({
        webhookInfo: {
          url: "",
          pending_update_count: 0
        }
      })
    });

    expect(adapter?.getTools().map((tool) => tool.name)).toEqual([
      "telegram_send_message"
    ]);
  });

  it("routes a normal Telegram message into the selected Pineapple thread", async () => {
    const enqueuedTriggers: TriggerEvent[] = [];
    const threadStore = new InMemoryThreadStore();
    const threadSelectionStore = new InMemoryTelegramThreadSelectionStore();
    const existingThread = await threadStore.create({});
    await threadSelectionStore.setCurrent("5001", existingThread.threadId);
    const adapter = createTelegramAdapter({
      botToken: "bot-token",
      inboundMode: "webhook",
      webhookSecret: "telegram-secret",
      webhookBaseUrl: "https://pineapple.example.ts.net",
      threadStore,
      threadSelectionStore,
      client: createFakeTelegramBotClient({
        webhookInfo: {
          url: "",
          pending_update_count: 0
        }
      })
    });
    const daemon = new PineappleDaemon(async (triggerEvent) => {
      enqueuedTriggers.push(triggerEvent);
      return {
        route: { kind: "direct_thread", thread: { threadId: existingThread.threadId } },
        thread: { threadId: existingThread.threadId },
        execution: {
          executionId: "execution-1",
          status: "completed",
          entrypointAgentId: "root_manager"
        },
        finalOutput: "",
        lastResponseId: "resp-1",
        activeAgentId: "root_manager",
        activeAgentName: "Root Manager",
        usedTools: [],
        pendingDecision: null
      } as never;
    });
    daemon.start();

    const app = Fastify();
    apps.push(app);
    adapter!.registerRoutes(app, {
      execution: createFakeExecutionService(daemon)
    });

    const response = await app.inject({
      method: "POST",
      url: telegramWebhookPath,
      headers: {
        [telegramWebhookSecretHeader]: "telegram-secret"
      },
      payload: {
        update_id: 1001,
        message: {
          message_id: 55,
          date: 1_775_526_400,
          text: "Hello from Telegram",
          from: {
            id: 42,
            is_bot: false
          },
          chat: {
            id: 5001,
            type: "private"
          }
        }
      }
    });

    expect(response.statusCode).toBe(200);
    await vi.waitFor(() => {
      expect(enqueuedTriggers).toHaveLength(1);
    });
    await daemon.whenIdle();
    expect(enqueuedTriggers).toHaveLength(1);
    expect(enqueuedTriggers[0]).toMatchObject({
      trigger_id: "telegram:update:1001",
      routing: {
        thread_id: existingThread.threadId
      }
    });
  });

  it("does not expose the webhook route when polling mode is selected", async () => {
    const threadStore = new InMemoryThreadStore();
    const threadSelectionStore = new InMemoryTelegramThreadSelectionStore();
    const adapter = createTelegramAdapter({
      botToken: "bot-token",
      inboundMode: "polling",
      threadStore,
      threadSelectionStore,
      client: createFakeTelegramBotClient({
        webhookInfo: {
          url: "",
          pending_update_count: 0
        }
      })
    });
    const app = Fastify();
    apps.push(app);
    adapter!.registerRoutes(app, {
      execution: null
    });

    const response = await app.inject({
      method: "POST",
      url: telegramWebhookPath,
      headers: {
        [telegramWebhookSecretHeader]: "telegram-secret"
      },
      payload: {
        update_id: 1006
      }
    });

    expect(response.statusCode).toBe(404);
  });

  it("fails fast when webhook settings are provided in polling mode", () => {
    expect(() =>
      createTelegramAdapter({
        botToken: "bot-token",
        inboundMode: "polling",
        webhookSecret: "telegram-secret",
        webhookBaseUrl: "https://pineapple.example.ts.net"
      })
    ).toThrow(/only valid when TELEGRAM_INBOUND_MODE=webhook/);
  });

  it("creates a new Pineapple thread when handling /new", async () => {
    const threadStore = new InMemoryThreadStore();
    const threadSelectionStore = new InMemoryTelegramThreadSelectionStore();
    const client = createFakeTelegramBotClient({
      webhookInfo: {
        url: "",
        pending_update_count: 0
      }
    });
    const adapter = createTelegramAdapter({
      botToken: "bot-token",
      inboundMode: "webhook",
      webhookSecret: "telegram-secret",
      webhookBaseUrl: "https://pineapple.example.ts.net",
      threadStore,
      threadSelectionStore,
      client
    });

    const app = Fastify();
    apps.push(app);
    adapter!.registerRoutes(app, {
      execution: null
    });

    const response = await app.inject({
      method: "POST",
      url: telegramWebhookPath,
      headers: {
        [telegramWebhookSecretHeader]: "telegram-secret"
      },
      payload: {
        update_id: 1002,
        message: {
          message_id: 56,
          date: 1_775_526_460,
          text: "/new",
          from: {
            id: 42,
            is_bot: false
          },
          chat: {
            id: 5001,
            type: "private"
          }
        }
      }
    });

    expect(response.statusCode).toBe(200);
    await vi.waitFor(() => {
      expect(client.sendMessage).toHaveBeenCalledTimes(1);
    });
    expect(threadStore.list()).toHaveLength(1);
    const currentThreadId = await threadSelectionStore.getCurrent("5001");
    expect(currentThreadId).toBe(threadStore.list()[0]?.threadId);
  });

  it("lists recent threads and marks the current one", async () => {
    const threadStore = new InMemoryThreadStore();
    const threadSelectionStore = new InMemoryTelegramThreadSelectionStore();
    await threadStore.create({});
    const secondThread = await threadStore.create({});
    await threadSelectionStore.setCurrent("5001", secondThread.threadId);
    const client = createFakeTelegramBotClient({
      webhookInfo: {
        url: "",
        pending_update_count: 0
      }
    });
    const adapter = createTelegramAdapter({
      botToken: "bot-token",
      inboundMode: "webhook",
      webhookSecret: "telegram-secret",
      webhookBaseUrl: "https://pineapple.example.ts.net",
      threadStore,
      threadSelectionStore,
      client
    });

    const app = Fastify();
    apps.push(app);
    adapter!.registerRoutes(app, {
      execution: null
    });

    const response = await app.inject({
      method: "POST",
      url: telegramWebhookPath,
      headers: {
        [telegramWebhookSecretHeader]: "telegram-secret"
      },
      payload: {
        update_id: 1003,
        message: {
          message_id: 57,
          date: 1_775_526_520,
          text: "/list",
          from: {
            id: 42,
            is_bot: false
          },
          chat: {
            id: 5001,
            type: "private"
          }
        }
      }
    });

    expect(response.statusCode).toBe(200);
    await vi.waitFor(() => {
      expect(client.sendMessage).toHaveBeenCalled();
    });
    expect(client.sendMessage).toHaveBeenCalledWith({
      chat_id: "5001",
      text: expect.stringContaining(`Current: ${secondThread.threadId}`),
      message_thread_id: undefined
    });
    expect(client.sendMessage).toHaveBeenCalledWith({
      chat_id: "5001",
      text: expect.stringContaining(`* ${secondThread.threadId.slice(0, 8)}  ${secondThread.threadId}`),
      message_thread_id: undefined
    });
  });

  it("switches the current thread with /select using a thread id prefix", async () => {
    const threadStore = new InMemoryThreadStore();
    const threadSelectionStore = new InMemoryTelegramThreadSelectionStore();
    const firstThread = await threadStore.create({});
    const secondThread = await threadStore.create({});
    await threadSelectionStore.setCurrent("5001", secondThread.threadId);
    const client = createFakeTelegramBotClient({
      webhookInfo: {
        url: "",
        pending_update_count: 0
      }
    });
    const adapter = createTelegramAdapter({
      botToken: "bot-token",
      inboundMode: "webhook",
      webhookSecret: "telegram-secret",
      webhookBaseUrl: "https://pineapple.example.ts.net",
      threadStore,
      threadSelectionStore,
      client
    });

    const app = Fastify();
    apps.push(app);
    adapter!.registerRoutes(app, {
      execution: null
    });

    const response = await app.inject({
      method: "POST",
      url: telegramWebhookPath,
      headers: {
        [telegramWebhookSecretHeader]: "telegram-secret"
      },
      payload: {
        update_id: 1004,
        message: {
          message_id: 58,
          date: 1_775_526_580,
          text: `/select ${firstThread.threadId.slice(0, 8)}`,
          from: {
            id: 42,
            is_bot: false
          },
          chat: {
            id: 5001,
            type: "private"
          }
        }
      }
    });

    expect(response.statusCode).toBe(200);
    await vi.waitFor(() => {
      expect(client.sendMessage).toHaveBeenCalled();
    });
    expect(client.sendMessage).toHaveBeenCalledWith({
      chat_id: "5001",
      text: `Current Pineapple thread set to ${firstThread.threadId}`,
      message_thread_id: undefined
    });
    const currentThreadId = await threadSelectionStore.getCurrent("5001");
    expect(currentThreadId).toBe(firstThread.threadId);
  });

  it("lists agents and selects a direct Telegram agent", async () => {
    const threadStore = new InMemoryThreadStore();
    const threadSelectionStore = new InMemoryTelegramThreadSelectionStore();
    const client = createFakeTelegramBotClient({
      webhookInfo: {
        url: "",
        pending_update_count: 0
      }
    });
    const adapter = createTelegramAdapter({
      botToken: "bot-token",
      inboundMode: "webhook",
      webhookSecret: "telegram-secret",
      webhookBaseUrl: "https://pineapple.example.ts.net",
      threadStore,
      threadSelectionStore,
      client
    });
    const daemon = new PineappleDaemon(async () => undefined as never);
    daemon.start();

    const app = Fastify();
    apps.push(app);
    adapter!.registerRoutes(app, {
      execution: createFakeExecutionService(daemon)
    });

    await app.inject({
      method: "POST",
      url: telegramWebhookPath,
      headers: {
        [telegramWebhookSecretHeader]: "telegram-secret"
      },
      payload: {
        update_id: 1007,
        message: {
          message_id: 60,
          date: 1_775_526_700,
          text: "/agents",
          from: {
            id: 42,
            is_bot: false
          },
          chat: {
            id: 5001,
            type: "private"
          }
        }
      }
    });

    await vi.waitFor(() => {
      expect(client.sendMessage).toHaveBeenCalledWith({
        chat_id: "5001",
        text: expect.stringContaining("codex - Codex"),
        message_thread_id: undefined
      });
    });

    await app.inject({
      method: "POST",
      url: telegramWebhookPath,
      headers: {
        [telegramWebhookSecretHeader]: "telegram-secret"
      },
      payload: {
        update_id: 1008,
        message: {
          message_id: 61,
          date: 1_775_526_760,
          text: "/agent codex",
          from: {
            id: 42,
            is_bot: false
          },
          chat: {
            id: 5001,
            type: "private"
          }
        }
      }
    });

    await vi.waitFor(async () => {
      expect(await threadSelectionStore.getCurrentAgent("5001")).toBe("codex");
    });
    expect(client.sendMessage).toHaveBeenCalledWith({
      chat_id: "5001",
      text: "Current Pineapple agent set to codex",
      message_thread_id: undefined
    });

    await app.inject({
      method: "POST",
      url: telegramWebhookPath,
      headers: {
        [telegramWebhookSecretHeader]: "telegram-secret"
      },
      payload: {
        update_id: 1009,
        message: {
          message_id: 62,
          date: 1_775_526_820,
          text: "/agent auto",
          from: {
            id: 42,
            is_bot: false
          },
          chat: {
            id: 5001,
            type: "private"
          }
        }
      }
    });

    await vi.waitFor(async () => {
      expect(await threadSelectionStore.getCurrentAgent("5001")).toBeNull();
    });
    expect(client.sendMessage).toHaveBeenCalledWith({
      chat_id: "5001",
      text: "Agent routing set to auto.",
      message_thread_id: undefined
    });

    await daemon.stop();
  });

  it("attaches the selected direct agent to normal Telegram trigger payloads", async () => {
    const enqueuedTriggers: TriggerEvent[] = [];
    const threadStore = new InMemoryThreadStore();
    const threadSelectionStore = new InMemoryTelegramThreadSelectionStore();
    const existingThread = await threadStore.create({});
    await threadSelectionStore.setCurrent("5001", existingThread.threadId);
    await threadSelectionStore.setCurrentAgent("5001", "codex");
    const adapter = createTelegramAdapter({
      botToken: "bot-token",
      inboundMode: "webhook",
      webhookSecret: "telegram-secret",
      webhookBaseUrl: "https://pineapple.example.ts.net",
      threadStore,
      threadSelectionStore,
      client: createFakeTelegramBotClient({
        webhookInfo: {
          url: "",
          pending_update_count: 0
        }
      })
    });
    const daemon = new PineappleDaemon(async (triggerEvent) => {
      enqueuedTriggers.push(triggerEvent);
      return {
        route: { kind: "direct_thread", thread: { threadId: existingThread.threadId } },
        thread: { threadId: existingThread.threadId },
        execution: {
          executionId: "execution-1",
          status: "completed",
          entrypointAgentId: "codex"
        },
        finalOutput: "",
        lastResponseId: "resp-1",
        activeAgentId: "codex",
        activeAgentName: "Codex",
        usedTools: [],
        pendingDecision: null
      } as never;
    });
    daemon.start();

    const app = Fastify();
    apps.push(app);
    adapter!.registerRoutes(app, {
      execution: createFakeExecutionService(daemon)
    });

    const response = await app.inject({
      method: "POST",
      url: telegramWebhookPath,
      headers: {
        [telegramWebhookSecretHeader]: "telegram-secret"
      },
      payload: {
        update_id: 1009,
        message: {
          message_id: 62,
          date: 1_775_526_820,
          text: "Inspect the repo",
          from: {
            id: 42,
            is_bot: false
          },
          chat: {
            id: 5001,
            type: "private"
          }
        }
      }
    });

    expect(response.statusCode).toBe(200);
    await vi.waitFor(() => {
      expect(enqueuedTriggers).toHaveLength(1);
    });
    await daemon.whenIdle();
    expect(enqueuedTriggers[0]?.payload).toMatchObject({
      agent_id: "codex"
    });
    await daemon.stop();
  });

  it("configures the webhook on startup when Telegram state drifts", async () => {
    const threadStore = new InMemoryThreadStore();
    const threadSelectionStore = new InMemoryTelegramThreadSelectionStore();
    const client = createFakeTelegramBotClient({
      myCommands: [],
      webhookInfo: {
        url: "",
        pending_update_count: 0
      }
    });
    const adapter = createTelegramAdapter({
      botToken: "bot-token",
      inboundMode: "webhook",
      webhookSecret: "telegram-secret",
      webhookBaseUrl: "https://pineapple.example.ts.net",
      allowedUpdates: ["message", "edited_message"],
      webhookMaxConnections: 10,
      threadStore,
      threadSelectionStore,
      client
    });

    await adapter!.initialize?.({
      logger: createFakeLogger(),
      execution: null
    });

    expect(client.getMyCommands).toHaveBeenCalledTimes(1);
    expect(client.setMyCommands).toHaveBeenCalledWith([
      { command: "agents", description: "List Pineapple agents" },
      { command: "agent", description: "Select Pineapple agent routing" },
      { command: "new", description: "Start a new Pineapple thread" },
      { command: "list", description: "List recent Pineapple threads" },
      { command: "select", description: "Select a Pineapple thread" },
      { command: "current", description: "Show the current Pineapple thread" },
      { command: "help", description: "Show Pineapple bot commands" }
    ]);
    expect(client.setWebhook).toHaveBeenCalledWith({
      url: "https://pineapple.example.ts.net/adapters/telegram/webhook",
      secret_token: "telegram-secret",
      allowed_updates: ["message", "edited_message"],
      max_connections: 10
    });
  });

  it("refreshes the webhook when Telegram webhook config already matches visibly", async () => {
    const threadStore = new InMemoryThreadStore();
    const threadSelectionStore = new InMemoryTelegramThreadSelectionStore();
    const client = createFakeTelegramBotClient({
      myCommands: [
        { command: "agents", description: "List Pineapple agents" },
        { command: "agent", description: "Select Pineapple agent routing" },
        { command: "new", description: "Start a new Pineapple thread" },
        { command: "list", description: "List recent Pineapple threads" },
        { command: "select", description: "Select a Pineapple thread" },
        { command: "current", description: "Show the current Pineapple thread" },
        { command: "help", description: "Show Pineapple bot commands" }
      ],
      webhookInfo: {
        url: "https://pineapple.example.ts.net/adapters/telegram/webhook",
        pending_update_count: 0,
        allowed_updates: ["message", "edited_message"],
        max_connections: 10
      }
    });
    const adapter = createTelegramAdapter({
      botToken: "bot-token",
      inboundMode: "webhook",
      webhookSecret: "telegram-secret",
      webhookBaseUrl: "https://pineapple.example.ts.net",
      allowedUpdates: ["message", "edited_message"],
      webhookMaxConnections: 10,
      threadStore,
      threadSelectionStore,
      client
    });

    await adapter!.initialize?.({
      logger: createFakeLogger(),
      execution: null
    });

    expect(client.setMyCommands).not.toHaveBeenCalled();
    expect(client.setWebhook).toHaveBeenCalledWith({
      url: "https://pineapple.example.ts.net/adapters/telegram/webhook",
      secret_token: "telegram-secret",
      allowed_updates: ["message", "edited_message"],
      max_connections: 10
    });
  });

  it("falls back to sending the final output text when the model does not call telegram_send_message", async () => {
    const threadStore = new InMemoryThreadStore();
    const threadSelectionStore = new InMemoryTelegramThreadSelectionStore();
    const client = createFakeTelegramBotClient({
      webhookInfo: {
        url: "",
        pending_update_count: 0
      }
    });
    const adapter = createTelegramAdapter({
      botToken: "bot-token",
      inboundMode: "webhook",
      webhookSecret: "telegram-secret",
      webhookBaseUrl: "https://pineapple.example.ts.net",
      threadStore,
      threadSelectionStore,
      client
    });
    const daemon = new PineappleDaemon(async () => ({
      route: { kind: "unbound_create", thread: { threadId: "thread-1" } },
      thread: { threadId: "thread-1" },
      execution: {
        executionId: "execution-1",
        status: "completed",
        entrypointAgentId: "root_manager"
      },
      finalOutput: "Plain text reply",
      lastResponseId: "resp-1",
      activeAgentId: "root_manager",
      activeAgentName: "Root Manager",
      usedTools: [],
      pendingDecision: null
    }) as never);
    daemon.start();

    const app = Fastify();
    apps.push(app);
    adapter!.registerRoutes(app, {
      execution: createFakeExecutionService(daemon)
    });

    const response = await app.inject({
      method: "POST",
      url: telegramWebhookPath,
      headers: {
        [telegramWebhookSecretHeader]: "telegram-secret"
      },
      payload: {
        update_id: 1005,
        message: {
          message_id: 59,
          date: 1_775_526_640,
          text: "Hello again",
          from: {
            id: 42,
            is_bot: false
          },
          chat: {
            id: 5001,
            type: "private"
          }
        }
      }
    });

    await daemon.whenIdle();
    await vi.waitFor(() => {
      expect(client.sendMessage).toHaveBeenCalledWith({
        chat_id: "5001",
        text: "Plain text reply",
        message_thread_id: undefined
      });
    });
    expect(response.statusCode).toBe(200);
  });
});

class InMemoryThreadStore implements ThreadStore {
  private readonly records = new Map<string, Thread>();

  async get(threadId: string): Promise<Thread | null> {
    return this.records.get(threadId) ?? null;
  }

  async findBySubject(): Promise<Thread | null> {
    return null;
  }

  async listRecent(limit: number): Promise<Thread[]> {
    return [...this.records.values()].reverse().slice(0, limit);
  }

  async create(input: NewThread): Promise<Thread> {
    const thread = createThread(input);
    this.records.set(thread.threadId, thread);
    return thread;
  }

  async update(thread: Thread): Promise<void> {
    this.records.set(thread.threadId, thread);
  }

  list(): Thread[] {
    return [...this.records.values()];
  }
}

class InMemoryTelegramThreadSelectionStore implements TelegramThreadSelectionStore {
  private readonly records = new Map<string, string>();

  async initialize(): Promise<void> {
    return;
  }

  async getCurrent(contextKey: string): Promise<string | null> {
    return this.records.get(contextKey) ?? null;
  }

  async setCurrent(contextKey: string, threadId: string): Promise<void> {
    this.records.set(contextKey, threadId);
  }

  async getCurrentAgent(contextKey: string): Promise<string | null> {
    return this.agentRecords.get(contextKey) ?? null;
  }

  async setCurrentAgent(contextKey: string, agentId: string | null): Promise<void> {
    if (agentId === null) {
      this.agentRecords.delete(contextKey);
      return;
    }

    this.agentRecords.set(contextKey, agentId);
  }

  private readonly agentRecords = new Map<string, string>();
}

function createFakeTelegramBotClient(options: {
  myCommands?: {
    command: string;
    description: string;
  }[];
  webhookInfo: {
    url: string;
    pending_update_count: number;
    allowed_updates?: string[];
    max_connections?: number;
  };
}): TelegramBotClientLike & {
  sendMessage: ReturnType<typeof vi.fn>;
  getUpdates: ReturnType<typeof vi.fn>;
  getMyCommands: ReturnType<typeof vi.fn>;
  getWebhookInfo: ReturnType<typeof vi.fn>;
  deleteWebhook: ReturnType<typeof vi.fn>;
  setMyCommands: ReturnType<typeof vi.fn>;
  setWebhook: ReturnType<typeof vi.fn>;
} {
  return {
    sendMessage: vi.fn().mockResolvedValue({
      message_id: 1,
      date: 1_775_526_400,
      chat: {
        id: 5001,
        type: "private"
      }
    }),
    getUpdates: vi.fn().mockResolvedValue([]),
    getMyCommands: vi.fn().mockResolvedValue(options.myCommands ?? []),
    getWebhookInfo: vi.fn().mockResolvedValue(options.webhookInfo),
    deleteWebhook: vi.fn().mockResolvedValue(true),
    setMyCommands: vi.fn().mockResolvedValue(true),
    setWebhook: vi.fn().mockResolvedValue(true)
  };
}

function createFakeExecutionService(
  daemon: PineappleDaemon<never>
): AppExecutionService {
  return {
    getQueueStatus: () => daemon.getStatus(),
    canResolveDecisions: () => false,
    listAgents: () => [
      {
        id: "root_manager",
        name: "Root Manager",
        description: "Routes work.",
        handoffDescription: "Routes work.",
        handoffs: ["codex"],
        agentTools: ["codex"],
        entrypoint: true,
        toolsets: [],
        sessionBackendKind: null
      },
      {
        id: "codex",
        name: "Codex",
        description: "Coding specialist.",
        handoffDescription: "Handles coding work.",
        handoffs: [],
        agentTools: [],
        entrypoint: false,
        toolsets: [],
        sessionBackendKind: null
      }
    ],
    getAgentSummary(agentId: string) {
      return this.listAgents().find((agent) => agent.id === agentId) ?? null;
    },
    hasAgent(agentId: string) {
      return this.getAgentSummary(agentId) !== null;
    },
    getEntrypointAgentId: () => "root_manager",
    submitTrigger: async (triggerEvent) => await daemon.submitTrigger(triggerEvent),
    enqueueTrigger: (triggerEvent, onError, onSuccess) =>
      daemon.enqueueTrigger(triggerEvent, onError, onSuccess),
    runTurn: vi.fn(),
    resolveDecision: vi.fn(),
    recoverActiveRuns: vi.fn()
  } as AppExecutionService;
}

function createFakeLogger() {
  return {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    debug: vi.fn(),
    child: vi.fn()
  } as never;
}
