import { reopenThread, type Thread } from "../../threads/domain/thread.js";
import type { ThreadStore } from "../../threads/store/thread-store.js";

export async function resolveSubjectThread(
  subjectType: string,
  subjectId: string,
  threadStore: ThreadStore
): Promise<Thread | null> {
  const existingThread = await threadStore.findBySubject(subjectType, subjectId);

  if (existingThread === null) {
    return null;
  }

  if (existingThread.closedAt === null) {
    return existingThread;
  }

  const reopenedThread = reopenThread(existingThread);
  await threadStore.update(reopenedThread);
  return reopenedThread;
}
