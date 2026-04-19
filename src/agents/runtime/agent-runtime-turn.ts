import { type Agent, type AgentInputItem, type Runner } from "@openai/agents";

import type { AgentRuntimeContext } from "../agent-runtime-context.js";
import type {
  AgentExecuteTurnOptions,
  AgentExecuteTurnResult,
  AgentRuntimeOptions
} from "../agent-runtime.js";
import { updateAgentThreadState } from "../domain/agent-thread.js";
import { AgentThreadNotFoundError } from "../errors.js";
import { PersistentAgentThreadSession } from "../persistent-agent-thread-session.js";
import { restoreRunState } from "../restore-run-state.js";
import type { SessionBackend } from "../session-backends/session-backend.js";
import { trace, traceError } from "../../utils/trace.js";

export async function executeAgentRuntimeTurn(input: {
  initialized: boolean;
  entrypointAgentId: string | null;
  options: AgentRuntimeOptions;
  agents: Map<string, Agent<AgentRuntimeContext>>;
  agentIdsByInstance: Map<Agent<AgentRuntimeContext>, string>;
  sessionBackendsByAgentId: Map<string, SessionBackend>;
  runner: Runner;
  optionsForTurn: AgentExecuteTurnOptions;
}): Promise<AgentExecuteTurnResult> {
  if (!input.initialized || input.entrypointAgentId === null) {
    throw new Error("Agent runtime is not initialized.");
  }

  const requestedAgentId = input.optionsForTurn.agentId ?? input.entrypointAgentId;
  const requestedAgent = input.agents.get(requestedAgentId);

  if (!requestedAgent) {
    throw new Error(`Unknown agent ${requestedAgentId}.`);
  }

  if (
    input.optionsForTurn.input === undefined &&
    input.optionsForTurn.serializedState === undefined
  ) {
    throw new Error("Agent runtime requires input or serializedState.");
  }

  if (
    input.optionsForTurn.approvalResolution !== undefined &&
    input.optionsForTurn.serializedState === undefined
  ) {
    throw new Error("Agent runtime approval resolution requires serializedState.");
  }

  const thread =
    input.optionsForTurn.threadId === undefined
      ? await input.options.threadStore.create({})
      : await input.options.threadStore.get(input.optionsForTurn.threadId);

  if (!thread) {
    throw new AgentThreadNotFoundError(input.optionsForTurn.threadId!);
  }
  trace("runner", "turn context ready", {
    threadId: thread.threadId,
    requestedAgentId,
    hasSerializedState: input.optionsForTurn.serializedState !== undefined,
    hasApprovalResolution: input.optionsForTurn.approvalResolution !== undefined
  });

  let agentThread = await input.options.agentThreadStore.get(thread.threadId);

  if (agentThread === null) {
    agentThread = await input.options.agentThreadStore.create({
      threadId: thread.threadId,
      entrypointAgentId: requestedAgentId,
      activeAgentId: requestedAgentId
    });
  }

  const specialistSessions = Object.fromEntries(
    (
      await input.options.specialistSessionStore.listByThread(thread.threadId)
    ).map((session) => [session.agentId, session])
  );
  const session = new PersistentAgentThreadSession(agentThread, input.options.agentThreadStore);
  const startingAgent =
    input.optionsForTurn.serializedState === undefined &&
    input.optionsForTurn.agentId !== undefined
      ? requestedAgent
      : input.agents.get(agentThread.activeAgentId) ?? requestedAgent;
  const runnerInput =
    input.optionsForTurn.serializedState === undefined
      ? input.optionsForTurn.input!
      : await restoreRunState({
          serializedState: input.optionsForTurn.serializedState,
          rootAgent: input.agents.get(agentThread.entrypointAgentId) ?? requestedAgent,
          approvalResolution: input.optionsForTurn.approvalResolution
        });
  const result = await (async () => {
    try {
      trace("runner", "runner.run start", {
        threadId: thread.threadId,
        startingAgentId: input.agentIdsByInstance.get(startingAgent) ?? requestedAgentId,
        activeAgentId: agentThread.activeAgentId
      });
      return await input.runner.run(
        startingAgent,
        runnerInput as string | AgentInputItem[],
        {
          session,
          context: {
            threadId: thread.threadId,
            specialistSessions
          }
        }
      );
    } catch (error) {
      traceError("runner", "runner.run failed", error, {
        threadId: thread.threadId,
        requestedAgentId
      });
      throw error;
    }
  })();

  trace("runner", "runner.run done", {
    threadId: thread.threadId,
    lastResponseId: result.lastResponseId ?? null,
    interruptionCount: result.interruptions.length,
    newItemCount: result.newItems.length
  });
  const activeAgentId =
    (result.activeAgent && input.agentIdsByInstance.get(result.activeAgent)) ??
    agentThread.activeAgentId;
  const finalOutput =
    typeof result.finalOutput === "string"
      ? result.finalOutput
      : JSON.stringify(result.finalOutput ?? "");

  agentThread = updateAgentThreadState(session.getAgentThread(), {
    activeAgentId
  });
  session.setAgentThread(agentThread);
  await input.options.agentThreadStore.update(agentThread);

  for (const sessionBackend of input.sessionBackendsByAgentId.values()) {
    const sessionUpdate = sessionBackend.extractSessionUpdate(result.output);

    if (sessionUpdate === null) {
      continue;
    }

    await input.options.specialistSessionStore.upsert({
      ...sessionUpdate,
      threadId: thread.threadId,
      agentId: sessionUpdate.agentId
    });
    trace("runner", "specialist session updated", {
      threadId: thread.threadId,
      agentId: sessionUpdate.agentId
    });
  }

  return {
    threadId: thread.threadId,
    rootAgentId: agentThread.entrypointAgentId,
    activeAgentId,
    activeAgentName: result.activeAgent?.name ?? requestedAgent.name,
    finalOutput,
    lastResponseId: result.lastResponseId ?? null,
    runState: result.state.toString(),
    interruptions: result.interruptions,
    newItems: result.newItems,
    outputItems: result.output
  };
}
