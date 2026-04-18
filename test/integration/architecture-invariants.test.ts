import { afterAll, afterEach, describe, expect, it } from "vitest";

import { agentExecutionKind } from "../../src/execution/domain/agent-execution.js";
import { DrizzleAgentExecutionDecisionStore } from "../../src/db/stores/agent-execution-decision-store.js";
import { DrizzleAgentExecutionStore } from "../../src/db/stores/agent-execution-store.js";
import { DrizzleThreadStore } from "../../src/db/stores/thread-store.js";
import { cleanupRecords, closeTestDatabase, insertRawThread } from "../support/database.js";

describe("Core persistence invariants", () => {
  const threadStore = new DrizzleThreadStore();
  const executionStore = new DrizzleAgentExecutionStore();
  const executionDecisionStore = new DrizzleAgentExecutionDecisionStore();

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

  it("prevents two active executions on the same thread", async () => {
    const thread = await threadStore.create({});
    createdIds.threadIds.push(thread.threadId);

    await executionStore.create({
      threadId: thread.threadId,
      kind: agentExecutionKind.trigger,
      triggerId: `trigger-${crypto.randomUUID()}`,
      entrypointAgentId: "root_manager",
      activeAgentId: "root_manager",
      checkpoint: {
        inputItems: [{ role: "user", content: "Inspect this thread" }],
        routeKind: "unbound_create",
        runState: null
      }
    });

    await expect(
      executionStore.create({
        threadId: thread.threadId,
        kind: agentExecutionKind.trigger,
        triggerId: `trigger-${crypto.randomUUID()}`,
        entrypointAgentId: "root_manager",
        activeAgentId: "root_manager",
        checkpoint: {
          inputItems: [{ role: "user", content: "Inspect this thread again" }],
          routeKind: "unbound_create",
          runState: null
        }
      })
    ).rejects.toThrow();
  });

  it("prevents two pending decisions for the same execution", async () => {
    const thread = await threadStore.create({});
    createdIds.threadIds.push(thread.threadId);

    const execution = await executionStore.create({
      threadId: thread.threadId,
      kind: agentExecutionKind.trigger,
      triggerId: `trigger-${crypto.randomUUID()}`,
      entrypointAgentId: "root_manager",
      activeAgentId: "root_manager",
      checkpoint: {
        inputItems: [{ role: "user", content: "Need approval" }],
        routeKind: "direct_thread",
        runState: "serialized-run-state"
      }
    });

    await executionDecisionStore.create({
      threadId: thread.threadId,
      executionId: execution.executionId,
      reasonCode: "approval_required",
      agentId: "root_manager",
      toolName: "telegram_send_message",
      toolCallId: "call-1",
      toolArguments: {
        chat_id: "5001"
      },
      requestedAction: {
        tool_name: "telegram_send_message"
      }
    });

    await expect(
      executionDecisionStore.create({
        threadId: thread.threadId,
        executionId: execution.executionId,
        reasonCode: "approval_required",
        agentId: "root_manager",
        toolName: "telegram_send_message",
        toolCallId: "call-2",
        toolArguments: {
          chat_id: "5001"
        },
        requestedAction: {
          tool_name: "telegram_send_message"
        }
      })
    ).rejects.toThrow();
  });

  it("prevents invalid raw thread subject binding at the database layer", async () => {
    await expect(
      insertRawThread({
        subjectType: "shortcut_story",
        subjectId: null
      })
    ).rejects.toThrow();
  });

  it("prevents duplicate active threads for the same subject", async () => {
    const subjectType = "shortcut_story";
    const subjectId = crypto.randomUUID();

    const firstThread = await threadStore.create({
      subjectType,
      subjectId
    });
    createdIds.threadIds.push(firstThread.threadId);

    await expect(
      threadStore.create({
        subjectType,
        subjectId
      })
    ).rejects.toThrow();
  });
});
