export class AgentExecutionDecisionNotFoundError extends Error {
  constructor(decisionId: string) {
    super(`Agent execution decision ${decisionId} was not found.`);
  }
}

export class AgentExecutionNotAwaitingApprovalError extends Error {
  constructor(executionId: string, status: string) {
    super(
      `Agent execution ${executionId} is not awaiting approval. Current status: ${status}.`
    );
  }
}
