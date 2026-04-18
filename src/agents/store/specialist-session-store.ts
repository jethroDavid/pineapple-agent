import type { JsonObject } from "../../shared/types/json.js";
import type { SpecialistSession } from "../domain/specialist-session.js";

export interface UpsertSpecialistSessionInput {
  threadId: string;
  agentId: string;
  provider: string;
  providerThreadId?: string | null;
  state?: JsonObject;
}

export interface SpecialistSessionStore {
  getByThreadAndAgent(threadId: string, agentId: string): Promise<SpecialistSession | null>;
  listByThread(threadId: string): Promise<SpecialistSession[]>;
  upsert(input: UpsertSpecialistSessionInput): Promise<SpecialistSession>;
}
