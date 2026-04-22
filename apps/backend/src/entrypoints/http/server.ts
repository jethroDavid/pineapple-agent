import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";

import type { AppAdapter } from "../../adapters/app-adapter.js";
import type { AppAgentRuntime } from "../../agents/agent-runtime.js";
import { env } from "../../config/env.js";
import { mapAppError } from "./error-mapper.js";
import { triggerEventSchema } from "../../execution/contracts/trigger-event.js";
import { parseDecisionResolutionRequest } from "../../execution/decision-resolution.js";
import type {
  AppExecutionService
} from "../../execution/pipeline/service.js";
import type { AgentExecutionDecision } from "../../execution/domain/agent-execution-decision.js";

interface BuildAppOptions {
  adapters?: AppAdapter[];
  agentRuntime?: AppAgentRuntime | null;
  execution?: AppExecutionService | null;
}

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const adapters = options.adapters ?? [];
  const agentRuntime = options.agentRuntime ?? null;
  const execution = options.execution ?? null;
  const queueEnabled = execution?.getQueueStatus() !== null;
  const loggerLevel = env.LOG_LEVEL ?? (env.NODE_ENV === "development" ? "debug" : "info");
  const app = Fastify({
    logger: {
      level: loggerLevel
    }
  });

  app.addContentTypeParser(
    "application/json",
    {
      parseAs: "buffer"
    },
    (request, body, done) => {
      try {
        const rawBody = Buffer.isBuffer(body) ? body : Buffer.from(body);
        (request as typeof request & { rawBody?: Buffer }).rawBody = rawBody;
        const rawText = rawBody.toString("utf8");
        done(null, rawText.length === 0 ? {} : JSON.parse(rawText));
      } catch (error) {
        done(error as Error, undefined);
      }
    }
  );

  app.setErrorHandler((error, _request, reply) => {
    const mapped = mapAppError(error);

    void reply.code(mapped.statusCode).send(mapped.body);
  });

  app.get("/", async () => {
    return {
      name: "pineapple",
      status: "ok",
      daemon: queueEnabled,
      agents: agentRuntime?.isReady() ?? false
    };
  });

  app.get("/health", async () => {
    return {
      status: "ok"
    };
  });

  app.get("/daemon", async () => {
    const queueStatus = execution?.getQueueStatus() ?? null;

    if (queueStatus === null) {
      return {
        enabled: false,
        reason: "OPENAI_API_KEY and OPENAI_MODEL must be configured."
      };
    }

    return {
      enabled: true,
      ...queueStatus
    };
  });

  app.get("/agents", async (_request, reply) => {
    if (agentRuntime === null) {
      return reply.code(503).send({
        error: "Agent runtime is not configured. Set OPENAI_API_KEY and OPENAI_MODEL first."
      });
    }

    if (!agentRuntime.isReady()) {
      return reply.code(503).send({
        error: "Agent runtime is not ready yet."
      });
    }

    return {
      entrypoint_agent_id: agentRuntime.getEntrypointAgentId(),
      agents: agentRuntime.listAgents()
    };
  });

  app.post("/agents/runs", async (request, reply) => {
    if (agentRuntime === null) {
      return reply.code(503).send({
        error: "Agent runtime is not configured. Set OPENAI_API_KEY and OPENAI_MODEL first."
      });
    }

    if (!agentRuntime.isReady()) {
      return reply.code(503).send({
        error: "Agent runtime is not ready yet."
      });
    }

    const body = agentRunRequestSchema.parse(request.body);
    if (execution === null) {
      return reply.code(503).send({
        error: "Execution service is not configured. Set OPENAI_API_KEY and OPENAI_MODEL first."
      });
    }

    const result = await execution.runTurn({
      agentId: body.agent_id,
      input: body.input,
      threadId: body.thread_id
    });

    return {
      thread_id: result.thread.threadId,
      execution_id: result.execution.executionId,
      execution_status: result.execution.status,
      root_agent_id: result.execution.entrypointAgentId,
      active_agent_id: result.activeAgentId,
      active_agent_name: result.activeAgentName,
      final_output: result.finalOutput,
      last_response_id: result.lastResponseId,
      pending_decision: toPendingDecisionResponse(result.pendingDecision)
    };
  });

  app.post("/triggers", async (request, reply) => {
    if (execution?.getQueueStatus() === null || execution === null) {
      return reply.code(503).send({
        error: "Daemon is not configured. Set OPENAI_API_KEY and OPENAI_MODEL first."
      });
    }

    const triggerEvent = triggerEventSchema.parse(request.body);
    const result = await execution.submitTrigger(triggerEvent);

    return {
      route: result.route?.kind ?? null,
      thread_id: result.thread.threadId,
      execution_id: result.execution.executionId,
      execution_status: result.execution.status,
      active_agent_id: result.activeAgentId,
      active_agent_name: result.activeAgentName,
      output_text: result.finalOutput,
      pending_decision: toPendingDecisionResponse(result.pendingDecision)
    };
  });

  app.post("/decisions/:decisionId/resolve", async (request, reply) => {
    if (execution === null || !execution.canResolveDecisions()) {
      return reply.code(503).send({
        error: "Decision resolution is not configured. Set OPENAI_API_KEY and OPENAI_MODEL first."
      });
    }

    const params = request.params as { decisionId: string };
    const resolution = parseDecisionResolutionRequest(request.body as Parameters<
      typeof parseDecisionResolutionRequest
    >[0]);
    const { decision, result } = await execution.resolveDecision(params.decisionId, resolution);

    return {
      decision_id: decision.decisionId,
      decision_status: decision.status,
      execution_id: result.execution.executionId,
      execution_status: result.execution.status,
      thread_id: result.thread.threadId,
      active_agent_id: result.activeAgentId,
      active_agent_name: result.activeAgentName,
      output_text: result.finalOutput,
      pending_decision: toPendingDecisionResponse(result.pendingDecision)
    };
  });

  for (const adapter of adapters) {
    adapter.registerRoutes(app, {
      execution
    });
  }

  return app;
}

const agentRunRequestSchema = z.object({
  agent_id: z.string().min(1).optional(),
  thread_id: z.string().uuid().optional(),
  input: z.string().min(1)
});

function toPendingDecisionResponse(decision: AgentExecutionDecision | null) {
  if (decision === null) {
    return null;
  }

  return {
    decision_id: decision.decisionId,
    status: decision.status,
    reason_code: decision.reasonCode,
    requested_action: decision.requestedAction,
    expires_at: decision.expiresAt?.toISOString() ?? null,
    created_at: decision.createdAt.toISOString()
  };
}
