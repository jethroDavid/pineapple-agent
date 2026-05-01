import type { SpecialistSession } from "./domain/specialist-session.js";

export interface AgentRuntimeContext {
  threadId: string;
  specialistSessions: Record<string, SpecialistSession>;
  turnSideEffects: Set<string>;
}
