import { and, eq, inArray } from "drizzle-orm";

import {
  createAgentExecution,
  restoreAgentExecution,
  activeAgentExecutionStatuses,
  type AgentExecution,
  type AgentExecutionStatus,
  type NewAgentExecution
} from "../../execution/domain/agent-execution.js";
import type { AgentExecutionStore } from "../../execution/store/agent-execution-store.js";
import { getDb } from "../client.js";
import { agentExecutions } from "../schema.js";

export class DrizzleAgentExecutionStore implements AgentExecutionStore {
  async create(input: NewAgentExecution): Promise<AgentExecution> {
    const db = getDb();
    const execution = createAgentExecution(input);
    const [record] = await db.insert(agentExecutions).values({
      ...execution,
      checkpoint: {
        ...execution.checkpoint,
        inputItems: execution.checkpoint.inputItems as never
      }
    }).returning();

    if (!record) {
      throw new Error("Failed to create agent execution.");
    }

    return restoreAgentExecution({
      ...record,
      checkpoint: {
        ...record.checkpoint,
        inputItems: record.checkpoint.inputItems as never
      }
    });
  }

  async get(executionId: string): Promise<AgentExecution | null> {
    const db = getDb();
    const [record] = await db
      .select()
      .from(agentExecutions)
      .where(eq(agentExecutions.executionId, executionId))
      .limit(1);

    return record
      ? restoreAgentExecution({
          ...record,
          checkpoint: {
            ...record.checkpoint,
            inputItems: record.checkpoint.inputItems as never
          }
        })
      : null;
  }

  async getActiveByThread(threadId: string): Promise<AgentExecution | null> {
    const db = getDb();
    const [record] = await db
      .select()
      .from(agentExecutions)
      .where(
        and(
          eq(agentExecutions.threadId, threadId),
          inArray(agentExecutions.status, [...activeAgentExecutionStatuses])
        )
      )
      .limit(1);

    return record
      ? restoreAgentExecution({
          ...record,
          checkpoint: {
            ...record.checkpoint,
            inputItems: record.checkpoint.inputItems as never
          }
        })
      : null;
  }

  async listByStatuses(statuses: AgentExecutionStatus[]): Promise<AgentExecution[]> {
    if (statuses.length === 0) {
      return [];
    }

    const db = getDb();
    const records = await db
      .select()
      .from(agentExecutions)
      .where(inArray(agentExecutions.status, statuses));

    return records.map((record) =>
      restoreAgentExecution({
        ...record,
        checkpoint: {
          ...record.checkpoint,
          inputItems: record.checkpoint.inputItems as never
        }
      })
    );
  }

  async update(execution: AgentExecution): Promise<void> {
    const db = getDb();
    const record = restoreAgentExecution(execution);

    await db
      .update(agentExecutions)
      .set({
        kind: record.kind,
        status: record.status,
        triggerId: record.triggerId,
        entrypointAgentId: record.entrypointAgentId,
        requestedAgentId: record.requestedAgentId,
        activeAgentId: record.activeAgentId,
        checkpoint: {
          ...record.checkpoint,
          inputItems: record.checkpoint.inputItems as never
        },
        errorCode: record.errorCode,
        errorMessage: record.errorMessage,
        startedAt: record.startedAt,
        endedAt: record.endedAt,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt
      })
      .where(eq(agentExecutions.executionId, record.executionId));
  }
}
