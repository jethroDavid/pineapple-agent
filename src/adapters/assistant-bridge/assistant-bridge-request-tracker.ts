interface TrackedRequest {
  requestId: string;
  threadId: string;
}

export class AssistantBridgeRequestTracker {
  #requestById = new Map<string, TrackedRequest>();
  #requestIdsByThreadId = new Map<string, string[]>();
  #requestsWithTts = new Set<string>();

  start(requestId: string, threadId: string): void {
    this.#requestById.set(requestId, {
      requestId,
      threadId
    });

    const queue = this.#requestIdsByThreadId.get(threadId) ?? [];
    queue.push(requestId);
    this.#requestIdsByThreadId.set(threadId, queue);
  }

  peekByThreadId(threadId: string): string | null {
    const queue = this.#requestIdsByThreadId.get(threadId);

    if (!queue || queue.length === 0) {
      return null;
    }

    return queue[0] ?? null;
  }

  markTts(requestId: string): void {
    this.#requestsWithTts.add(requestId);
  }

  hasTts(requestId: string): boolean {
    return this.#requestsWithTts.has(requestId);
  }

  complete(requestId: string): TrackedRequest | null {
    const trackedRequest = this.#requestById.get(requestId);

    if (!trackedRequest) {
      return null;
    }

    this.#requestsWithTts.delete(requestId);
    this.#requestById.delete(requestId);
    const queue = this.#requestIdsByThreadId.get(trackedRequest.threadId);

    if (!queue || queue.length === 0) {
      return trackedRequest;
    }

    const nextQueue = queue.filter((candidate) => candidate !== requestId);

    if (nextQueue.length === 0) {
      this.#requestIdsByThreadId.delete(trackedRequest.threadId);
      return trackedRequest;
    }

    this.#requestIdsByThreadId.set(trackedRequest.threadId, nextQueue);
    return trackedRequest;
  }
}
