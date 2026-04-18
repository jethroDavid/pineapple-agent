import { createHmac } from "node:crypto";

import { DrizzleQueryError } from "drizzle-orm/errors";

import { ShortcutClient } from "../../../../src/adapters/shortcut/shortcut-client.js";
import type { TelegramBotClientLike } from "../../../../src/adapters/telegram/telegram-bot-client.js";
import type {
  TelegramThreadSelectionStore
} from "../../../../src/adapters/telegram/telegram-thread-selection-store.js";
import type { TriggerEvent } from "../../../../src/execution/contracts/trigger-event.js";
import type {
  AgentExecutionDecision
} from "../../../../src/execution/domain/agent-execution-decision.js";

export function createFakeExecutionService(options: {
  triggerError?: unknown;
  agentError?: unknown;
  decisionResult?: {
    decision: Partial<AgentExecutionDecision>;
    result: {
      thread: {
        threadId: string;
      };
      execution: {
        executionId: string;
        status: string;
      };
      route: null;
      finalOutput: string | null;
      lastResponseId: string | null;
      activeAgentId: string;
      activeAgentName: string;
      usedTools: unknown[];
      pendingDecision: AgentExecutionDecision | null;
    };
  };
  enqueuedTriggers?: TriggerEvent[];
} = {}) {
  return {
    getQueueStatus() {
      return {
        state: "idle",
        queueDepth: 0,
        processedCount: 0,
        failedCount: 0
      };
    },
    canResolveDecisions() {
      return options.decisionResult !== undefined;
    },
    async submitTrigger() {
      if (options.triggerError) {
        throw options.triggerError;
      }

      return {
        route: {
          kind: "unbound_create"
        },
        thread: {
          threadId: "thread-1"
        },
        execution: {
          executionId: "execution-1",
          status: "completed",
          entrypointAgentId: "root_manager"
        },
        finalOutput: "hello",
        lastResponseId: "resp-1",
        activeAgentId: "root_manager",
        activeAgentName: "Root Manager",
        usedTools: [],
        pendingDecision: null
      };
    },
    enqueueTrigger(
      triggerEvent: TriggerEvent,
      _onError?: (error: unknown) => void,
      onSuccess?: (result: unknown) => void
    ) {
      options.enqueuedTriggers?.push(triggerEvent);
      onSuccess?.({
        execution: {
          status: "running"
        }
      });
    },
    async runTurn() {
      if (options.agentError) {
        throw options.agentError;
      }

      return {
        thread: {
          threadId: "thread-1"
        },
        execution: {
          executionId: "execution-1",
          status: "completed",
          entrypointAgentId: "root_manager"
        },
        route: null,
        finalOutput: "done",
        lastResponseId: "resp-agent-1",
        activeAgentId: "codex",
        activeAgentName: "Codex",
        usedTools: [],
        pendingDecision: null
      };
    },
    async resolveDecision() {
      if (!options.decisionResult) {
        throw new Error("Decision resolution is not configured.");
      }

      return options.decisionResult;
    },
    async recoverActiveRuns() {
      return [];
    }
  } as never;
}

export function createFakeAgentRuntime() {
  return {
    isReady() {
      return true;
    },
    getEntrypointAgentId() {
      return "root_manager";
    },
    listAgents() {
      return [];
    },
    async initialize() {
      return;
    },
    async close() {
      return;
    },
    async runTurn() {
      return undefined as never;
    }
  } as never;
}

export function validTriggerPayload() {
  return {
    version: 1,
    trigger_id: "cli:test-trigger-1",
    source: {
      kind: "cli",
      system: "pineapple-cli",
      event_type: "command.invoked"
    },
    actor: {
      type: "human",
      id: "jethro"
    },
    routing: {
      allow_unbound_thread: true
    },
    payload: {
      input: "Hello"
    },
    received_at: "2026-04-04T12:00:00.000Z"
  };
}

export function createDrizzleQueryError(options: {
  code: string;
  constraint: string;
  message: string;
}) {
  return new DrizzleQueryError("insert into runs ...", [], {
    name: "DatabaseError",
    message: options.message,
    code: options.code,
    constraint: options.constraint
  } as Error & { code: string; constraint: string });
}

export function validTelegramUpdatePayload() {
  return {
    update_id: 1001,
    message: {
      message_id: 55,
      date: 1_775_526_400,
      text: "Hello from Telegram",
      from: {
        id: 42,
        is_bot: false,
        username: "jethro",
        first_name: "Jethro"
      },
      chat: {
        id: 5001,
        type: "private"
      }
    }
  };
}

export function validShortcutWebhookPayload() {
  return {
    id: 9001,
    primary_id: 123,
    member_id: "member-1",
    changed_at: "2026-04-11T12:05:00.000Z",
    actions: [
      {
        entity_type: "comment",
        action: "create",
        id: 5001,
        story_id: 123
      }
    ]
  };
}

export function createShortcutSignature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export class InMemoryTelegramThreadSelectionStore
  implements TelegramThreadSelectionStore {
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
}

export function createFakeTelegramBotClient(): TelegramBotClientLike {
  return {
    async sendMessage() {
      return {
        message_id: 1,
        date: 1_775_526_400,
        chat: {
          id: 5001,
          type: "private"
        }
      };
    },
    async getUpdates() {
      return [];
    },
    async getMyCommands() {
      return [];
    },
    async getWebhookInfo() {
      return {
        url: "",
        pending_update_count: 0
      };
    },
    async deleteWebhook() {
      return true;
    },
    async setMyCommands() {
      return true;
    },
    async setWebhook() {
      return true;
    }
  };
}

export function createFakeShortcutClient(): ShortcutClient {
  return new ShortcutClient({
    apiToken: "shortcut-token",
    fetchImplementation: (async (input) => {
      const url = String(input);

      if (url.endsWith("/stories/123")) {
        return {
          ok: true,
          async json() {
            return {
              id: 123,
              name: "Add memory to the agent",
              description: "Copy open claw memory",
              workflow_state_id: 2,
              app_url: "https://app.shortcut.com/pineapple/story/123",
              comments: [
                {
                  id: 5001,
                  text: "Can you clarify the source memory?",
                  author_id: "member-2",
                  author_profile: {
                    name: "Jethro",
                    mention_name: "jethro"
                  }
                }
              ]
            };
          }
        } as Response;
      }

      if (url.endsWith("/workflows")) {
        return {
          ok: true,
          async json() {
            return [
              {
                id: 1,
                name: "Default",
                states: [
                  {
                    id: 2,
                    name: "In Progress"
                  }
                ]
              }
            ];
          }
        } as Response;
      }

      throw new Error(`Unexpected Shortcut client request: ${url}`);
    }) as typeof fetch
  });
}
