import { and, eq } from "drizzle-orm";

import {
  createAgentExecutionDecision,
  agentExecutionDecisionStatus,
  resolveAgentExecutionDecision,
  restoreAgentExecutionDecision,
  type AgentExecutionDecision,
  type AgentExecutionDecisionResolution,
  type NewAgentExecutionDecision
} from "../../execution/domain/agent-execution-decision.js";
import type { AgentExecutionDecisionStore } from "../../execution/store/agent-execution-decision-store.js";
import { getDb } from "../client.js";
import { agentExecutionDecisions } from "../schema.js";

export class DrizzleAgentExecutionDecisionStore implements AgentExecutionDecisionStore {
  async create(input: NewAgentExecutionDecision): Promise<AgentExecutionDecision> {
    const db = getDb();
    const decision = createAgentExecutionDecision(input);
    const [record] = await db.insert(agentExecutionDecisions).values(decision).returning();

    if (!record) {
      throw new Error("Failed to create agent execution decision.");
    }

    return restoreAgentExecutionDecision(record);
  }

  async get(decisionId: string): Promise<AgentExecutionDecision | null> {
    const db = getDb();
    const [record] = await db
      .select()
      .from(agentExecutionDecisions)
      .where(eq(agentExecutionDecisions.decisionId, decisionId))
      .limit(1);

    return record ? restoreAgentExecutionDecision(record) : null;
  }

  async getPendingByExecution(executionId: string): Promise<AgentExecutionDecision | null> {
    const db = getDb();
    const [record] = await db
      .select()
      .from(agentExecutionDecisions)
      .where(
        and(
          eq(agentExecutionDecisions.executionId, executionId),
          eq(agentExecutionDecisions.status, agentExecutionDecisionStatus.pending)
        )
      )
      .limit(1);

    return record ? restoreAgentExecutionDecision(record) : null;
  }

  async resolve(
    decisionId: string,
    resolution: AgentExecutionDecisionResolution
  ): Promise<AgentExecutionDecision> {
    const db = getDb();
    const existing = await this.get(decisionId);

    if (!existing) {
      throw new Error(`Agent execution decision ${decisionId} not found.`);
    }

    const resolved = resolveAgentExecutionDecision(existing, resolution);
    const [record] = await db
      .update(agentExecutionDecisions)
      .set({
        status: resolved.status,
        resolvedAt: resolved.resolvedAt,
        resolvedByActor: resolved.resolvedByActor
      })
      .where(eq(agentExecutionDecisions.decisionId, decisionId))
      .returning();

    if (!record) {
      throw new Error(`Failed to resolve agent execution decision ${decisionId}.`);
    }

    return restoreAgentExecutionDecision(record);
  }
}
