import type { AgentInputItem, Session } from "@openai/agents";

import {
  replaceAgentThreadSessionItems,
  type AgentThread
} from "./domain/agent-thread.js";
import type { AgentThreadStore } from "./store/agent-thread-store.js";

export class PersistentAgentThreadSession implements Session {
  #agentThread: AgentThread;

  constructor(
    agentThread: AgentThread,
    private readonly agentThreadStore: AgentThreadStore
  ) {
    this.#agentThread = agentThread;
  }

  async getSessionId(): Promise<string> {
    return this.#agentThread.threadId;
  }

  async getItems(limit?: number): Promise<AgentInputItem[]> {
    if (limit === undefined) {
      return [...this.#agentThread.sessionItems];
    }

    return this.#agentThread.sessionItems.slice(-limit);
  }

  async addItems(items: AgentInputItem[]): Promise<void> {
    this.#agentThread = replaceAgentThreadSessionItems(this.#agentThread, [
      ...this.#agentThread.sessionItems,
      ...items
    ]);
    await this.agentThreadStore.update(this.#agentThread);
  }

  async popItem(): Promise<AgentInputItem | undefined> {
    const nextItems = [...this.#agentThread.sessionItems];
    const item = nextItems.pop();

    this.#agentThread = replaceAgentThreadSessionItems(this.#agentThread, nextItems);
    await this.agentThreadStore.update(this.#agentThread);

    return item;
  }

  async clearSession(): Promise<void> {
    this.#agentThread = replaceAgentThreadSessionItems(this.#agentThread, []);
    await this.agentThreadStore.update(this.#agentThread);
  }

  getAgentThread(): AgentThread {
    return this.#agentThread;
  }

  setAgentThread(agentThread: AgentThread) {
    this.#agentThread = agentThread;
  }
}
