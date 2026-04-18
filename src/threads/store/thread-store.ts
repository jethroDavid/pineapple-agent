import type { NewThread, Thread } from "../domain/thread.js";

export interface ThreadStore {
  get(threadId: string): Promise<Thread | null>;
  listRecent(limit: number): Promise<Thread[]>;
  findBySubject(subjectType: string, subjectId: string): Promise<Thread | null>;
  create(input: NewThread): Promise<Thread>;
  update(thread: Thread): Promise<void>;
}
