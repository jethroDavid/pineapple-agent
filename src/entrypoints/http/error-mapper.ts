import { DrizzleQueryError } from "drizzle-orm/errors";
import OpenAI from "openai";
import { ZodError } from "zod";

import { AgentThreadNotFoundError } from "../../agents/errors.js";
import {
  TriggerRoutingError,
  triggerRoutingErrorCode
} from "../../execution/routing/route-trigger-event.js";
import {
  AgentExecutionDecisionResolutionError
} from "../../execution/domain/agent-execution-decision.js";
import {
  AgentExecutionDecisionNotFoundError,
  AgentExecutionNotAwaitingApprovalError
} from "../../execution/errors.js";

interface AppErrorResponse {
  statusCode: number;
  body: Record<string, unknown>;
}

export function mapAppError(error: unknown): AppErrorResponse {
  if (error instanceof ZodError) {
    return {
      statusCode: 400,
      body: {
        error: "Invalid request payload.",
        issues: error.issues
      }
    };
  }

  if (error instanceof TriggerRoutingError) {
    return {
      statusCode:
        error.code === triggerRoutingErrorCode.threadNotFound ? 404 : 400,
      body: {
        error: "Routing failed.",
        code: error.code,
        message: error.message
      }
    };
  }

  if (error instanceof AgentThreadNotFoundError) {
    return {
      statusCode: 404,
      body: {
        error: "Agent thread was not found.",
        message: error.message
      }
    };
  }

  if (error instanceof AgentExecutionDecisionNotFoundError) {
    return {
      statusCode: 404,
      body: {
        error: "Execution decision was not found.",
        message: error.message
      }
    };
  }

  if (
    error instanceof AgentExecutionDecisionResolutionError ||
    error instanceof AgentExecutionNotAwaitingApprovalError
  ) {
    return {
      statusCode: 409,
      body: {
        error: "Approval state conflict.",
        message: error.message
      }
    };
  }

  if (error instanceof DrizzleQueryError) {
    return mapDrizzleQueryError(error);
  }

  if (
    error instanceof OpenAI.APIConnectionError ||
    error instanceof OpenAI.APIConnectionTimeoutError ||
    error instanceof OpenAI.RateLimitError ||
    error instanceof OpenAI.InternalServerError
  ) {
    return {
      statusCode: 503,
      body: {
        error: "OpenAI is temporarily unavailable.",
        message: getOpenAIErrorMessage(error)
      }
    };
  }

  if (error instanceof OpenAI.APIError) {
    return {
      statusCode: 502,
      body: {
        error: "OpenAI request failed.",
        message: getOpenAIErrorMessage(error)
      }
    };
  }

  return {
    statusCode: 500,
    body: {
      error: "Internal Server Error"
    }
  };
}

function mapDrizzleQueryError(error: DrizzleQueryError): AppErrorResponse {
  const cause = error.cause as
    | {
        code?: string;
        constraint?: string;
      }
    | undefined;

  if (cause?.code === "23505") {
    if (cause.constraint === "agent_executions_trigger_id_unique_idx") {
      return {
        statusCode: 409,
        body: {
          error: "Duplicate trigger_id.",
          message: "This TriggerEvent was already accepted before."
        }
      };
    }

    if (cause.constraint === "agent_executions_active_thread_unique_idx") {
      return {
        statusCode: 409,
        body: {
          error: "Thread already has an active execution.",
          message: "Wait for the existing execution to complete before submitting another one."
        }
      };
    }

    return {
      statusCode: 409,
      body: {
        error: "Unique constraint violation."
      }
    };
  }

  if (cause?.code === "23514") {
    return {
      statusCode: 400,
      body: {
        error: "Constraint violation."
      }
    };
  }

  if (cause?.code === "23503") {
    return {
      statusCode: 409,
      body: {
        error: "Reference integrity violation."
      }
    };
  }

  return {
    statusCode: 500,
    body: {
      error: "Database query failed."
    }
  };
}

function getOpenAIErrorMessage(error: InstanceType<typeof OpenAI.APIError>): string {
  const errorBody = error.error as
    | {
        message?: string;
        error?: {
          message?: string;
        };
      }
    | undefined;

  return errorBody?.message ?? errorBody?.error?.message ?? error.message;
}
