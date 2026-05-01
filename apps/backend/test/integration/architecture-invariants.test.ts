import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { afterAll, afterEach, describe, expect, it } from "vitest";

import {
  DatabaseSchemaNotInitializedError,
  ensureDatabaseSchemaReady
} from "../../src/db/client.js";
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

  it("fails schema readiness when an adapter-declared relation is missing", async () => {
    await expect(
      ensureDatabaseSchemaReady([
        {
          relation: "definitely_missing_adapter_relation"
        }
      ])
    ).rejects.toThrow(DatabaseSchemaNotInitializedError);
  });
});

describe("Architecture boundaries", () => {
  it("keeps core DB schema independent from adapters", async () => {
    const schemaSource = await readFile(
      resolve("src/db/schema.ts"),
      "utf8"
    );

    expect(schemaSource).not.toMatch(/\.\.\/adapters\//);
    expect(schemaSource).not.toMatch(/from ["'].*adapters\//);
  });

  it("discovers adapter-owned DB schemas through Drizzle config", async () => {
    const drizzleConfigSource = await readFile(
      resolve("drizzle.config.ts"),
      "utf8"
    );

    expect(drizzleConfigSource).toContain("./src/db/schema.ts");
    expect(drizzleConfigSource).toContain("./src/adapters/**/**-db-schema.ts");
  });

  it("keeps adapter DB schema files free of runtime imports", async () => {
    const cronSchemaSource = await readFile(
      resolve("src/adapters/cron/cron-db-schema.ts"),
      "utf8"
    );

    expect(cronSchemaSource).not.toMatch(/cron-scheduler/);
    expect(cronSchemaSource).not.toMatch(/cron-adapter/);
    expect(cronSchemaSource).not.toMatch(/cron-.*-tool/);
    expect(cronSchemaSource).not.toMatch(/config\/env/);
  });
});
