import {
  createThread,
  restoreThread,
  type NewThread,
  type Thread
} from "../../src/threads/domain/thread.js";
import type { ThreadStore } from "../../src/threads/store/thread-store.js";

export class InMemoryThreadStore implements ThreadStore {
  readonly records = new Map<string, Thread>();

  async get(threadId: string): Promise<Thread | null> {
    return this.records.get(threadId) ?? null;
  }

  async listRecent(limit: number): Promise<Thread[]> {
    return [...this.records.values()].reverse().slice(0, limit);
  }

  async findBySubject(subjectType: string, subjectId: string): Promise<Thread | null> {
    const matches = [...this.records.values()]
      .filter(
        (thread) => thread.subjectType === subjectType && thread.subjectId === subjectId
      )
      .sort((left, right) => {
        const updatedDifference = right.updatedAt.getTime() - left.updatedAt.getTime();
        return updatedDifference !== 0
          ? updatedDifference
          : right.createdAt.getTime() - left.createdAt.getTime();
      });

    return matches[0] ?? null;
  }

  async create(input: NewThread): Promise<Thread> {
    const thread = createThread(input);
    this.records.set(thread.threadId, thread);
    return thread;
  }

  async update(thread: Thread): Promise<void> {
    this.records.set(thread.threadId, restoreThread(thread));
  }

  list(): Thread[] {
    return [...this.records.values()];
  }
}
