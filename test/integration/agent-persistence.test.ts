import { afterAll, afterEach, describe, expect, it } from "vitest";

import { DrizzleAgentThreadStore } from "../../src/db/stores/agent-thread-store.js";
import { DrizzleSpecialistSessionStore } from "../../src/db/stores/specialist-session-store.js";
import { DrizzleThreadStore } from "../../src/db/stores/thread-store.js";
import { cleanupRecords, closeTestDatabase } from "../support/database.js";

describe("Agent persistence", () => {
  const threadStore = new DrizzleThreadStore();
  const agentThreadStore = new DrizzleAgentThreadStore();
  const specialistSessionStore = new DrizzleSpecialistSessionStore();
  const createdIds: {
    threadIds: string[];
  } = {
    threadIds: []
  };

  afterEach(async () => {
    await cleanupRecords(createdIds);
    createdIds.threadIds.length = 0;
  });

  afterAll(async () => {
    await closeTestDatabase();
  });

  it("persists an agent thread and upserts one specialist session per thread and agent", async () => {
    const thread = await threadStore.create({});
    createdIds.threadIds.push(thread.threadId);

    const agentThread = await agentThreadStore.create({
      threadId: thread.threadId,
      entrypointAgentId: "root_manager"
    });

    expect(agentThread.threadId).toBe(thread.threadId);
    expect(agentThread.activeAgentId).toBe("root_manager");

    const firstSession = await specialistSessionStore.upsert({
      threadId: thread.threadId,
      agentId: "codex",
      provider: "codex_mcp",
      providerThreadId: "codex-thread-1",
      state: {
        threadId: "codex-thread-1"
      }
    });

    const secondSession = await specialistSessionStore.upsert({
      threadId: thread.threadId,
      agentId: "codex",
      provider: "codex_mcp",
      providerThreadId: "codex-thread-2",
      state: {
        threadId: "codex-thread-2"
      }
    });

    const sessions = await specialistSessionStore.listByThread(thread.threadId);

    expect(firstSession.specialistSessionId).toBe(secondSession.specialistSessionId);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.providerThreadId).toBe("codex-thread-2");
  });
});
