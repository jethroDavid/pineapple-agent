export class AgentThreadNotFoundError extends Error {
  constructor(threadId: string) {
    super(`Thread ${threadId} was not found.`);
    this.name = "AgentThreadNotFoundError";
  }
}
