import type { AssistantBridgeStreamEvent } from "./assistant-bridge-events.js";

type AssistantBridgeListener = (event: AssistantBridgeStreamEvent) => void;

export class AssistantBridgeEventBus {
  #nextId = 1;
  #listeners = new Map<number, AssistantBridgeListener>();

  emit(event: AssistantBridgeStreamEvent): void {
    for (const listener of this.#listeners.values()) {
      listener(event);
    }
  }

  subscribe(listener: AssistantBridgeListener): () => void {
    const listenerId = this.#nextId;
    this.#nextId += 1;
    this.#listeners.set(listenerId, listener);

    return () => {
      this.#listeners.delete(listenerId);
    };
  }
}
