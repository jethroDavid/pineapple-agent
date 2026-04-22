import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { AppAdapter, AppAdapterRouteContext } from "../app-adapter.js";
import type { ThreadStore } from "../../threads/store/thread-store.js";
import { createTriggerEvent, triggerActorType, triggerSourceKind } from "../../execution/contracts/trigger-event.js";
import { routeTriggerEvent } from "../../execution/routing/route-trigger-event.js";
import type { ExecutionTurnResult } from "../../execution/execution-contracts.js";
import { trace, traceError } from "../../utils/trace.js";
import {
  assistantBridgeAudioMimeType,
  delay,
  estimatePlaybackMsFromText,
  getWavDurationMs,
  splitBufferIntoBase64Chunks
} from "./assistant-bridge-audio.js";
import {
  assistantBridgeEventType,
  type AssistantBridgeStreamEvent
} from "./assistant-bridge-events.js";
import { AssistantBridgeEventBus } from "./assistant-bridge-event-bus.js";
import { AssistantBridgeRequestTracker } from "./assistant-bridge-request-tracker.js";
import { createAssistantBridgeTools } from "./assistant-bridge-tools.js";
import { AssistantBridgeOpenAiTtsClient } from "./assistant-bridge-openai-tts-client.js";
import { AssistantBridgeSpotifyClient } from "./assistant-bridge-spotify-client.js";

const assistantBridgeRequestSchema = z
  .object({
    request_id: z.string().min(1).optional(),
    actor_id: z.string().min(1).optional(),
    text: z.string().min(1),
    thread_id: z.uuid().optional(),
    subject_type: z.string().min(1).optional(),
    subject_id: z.string().min(1).optional(),
    allow_unbound_thread: z.boolean().optional()
  })
  .superRefine((input, ctx) => {
    if ((input.subject_type === undefined) !== (input.subject_id === undefined)) {
      ctx.addIssue({
        code: "custom",
        path: input.subject_type === undefined ? ["subject_type"] : ["subject_id"],
        message: "subject_type and subject_id must be provided together."
      });
    }
  });

type AssistantBridgeRequestBody = z.infer<typeof assistantBridgeRequestSchema>;

export interface AssistantBridgeAdapterOptions {
  enabled: boolean;
  threadStore: ThreadStore;
  agentId: string;
  defaultActorId: string;
  spotifyClient: AssistantBridgeSpotifyClient | null;
  openAiTtsClient: AssistantBridgeOpenAiTtsClient | null;
  ttsResumePaddingMs: number;
  spotifyDeviceCachePath: string;
}

const assistantBridgeRequestPath = "/adapters/assistant-bridge/request";
const assistantBridgeStreamPath = "/adapters/assistant-bridge/ws";
const assistantBridgeMusicControlToolNames = new Set([
  "assistant_bridge_spotify_play",
  "assistant_bridge_spotify_pause",
  "assistant_bridge_spotify_resume"
]);

export function createAssistantBridgeAdapter(
  options: AssistantBridgeAdapterOptions
): AppAdapter | null {
  if (!options.enabled) {
    return null;
  }

  let executionContext: AppAdapterRouteContext["execution"] = null;
  const eventBus = new AssistantBridgeEventBus();
  const requestTracker = new AssistantBridgeRequestTracker();
  eventBus.subscribe((event) => {
    if (
      event.request_id &&
      (event.type === assistantBridgeEventType.ttsPreparing ||
        event.type === assistantBridgeEventType.ttsChunk ||
        event.type === assistantBridgeEventType.ttsDone)
    ) {
      requestTracker.markTts(event.request_id);
    }
  });

  return {
    name: "assistant_bridge",
    getTools() {
      return createAssistantBridgeTools({
        eventBus,
        requestTracker,
        spotifyClient: options.spotifyClient,
        openAiTtsClient: options.openAiTtsClient,
        ttsResumePaddingMs: options.ttsResumePaddingMs,
        spotifyDevicesCachePath: options.spotifyDeviceCachePath
      });
    },
    registerRoutes(app: FastifyInstance, context: AppAdapterRouteContext) {
      executionContext = context.execution;

      app.post(assistantBridgeRequestPath, async (request, reply) => {
        if (executionContext === null) {
          return reply.code(503).send({
            error: "Execution service is not configured."
          });
        }

        const body = assistantBridgeRequestSchema.parse(request.body);
        const requestId = body.request_id ?? randomUUID();
        const actorId = body.actor_id ?? options.defaultActorId;
        const provisionalTrigger = createTriggerEvent({
          trigger_id: `assistant-bridge:request:${requestId}`,
          source: {
            kind: triggerSourceKind.http,
            system: "assistant_bridge",
            event_type: "request"
          },
          actor: {
            type: triggerActorType.human,
            id: actorId
          },
          routing: buildTriggerRouting(body),
          payload: {
            input: body.text,
            agent_id: options.agentId
          }
        });
        const route = await routeTriggerEvent(provisionalTrigger, {
          threadStore: options.threadStore
        });
        const pinnedTrigger = createTriggerEvent({
          ...provisionalTrigger,
          routing: {
            thread_id: route.thread.threadId
          }
        });

        requestTracker.start(requestId, route.thread.threadId);
        emitEvent(eventBus, {
          type: assistantBridgeEventType.requestReceived,
          request_id: requestId,
          thread_id: route.thread.threadId,
          execution_id: null,
          emitted_at: new Date().toISOString(),
          payload: {
            trigger_id: pinnedTrigger.trigger_id
          }
        });
        emitEvent(eventBus, {
          type: assistantBridgeEventType.queued,
          request_id: requestId,
          thread_id: route.thread.threadId,
          execution_id: null,
          emitted_at: new Date().toISOString()
        });

        executionContext.enqueueTrigger(
          pinnedTrigger,
          (error) => {
            traceError("assistant-bridge", "request failed", error, {
              requestId,
              threadId: route.thread.threadId
            });
            requestTracker.complete(requestId);
            emitEvent(eventBus, {
              type: assistantBridgeEventType.error,
              request_id: requestId,
              thread_id: route.thread.threadId,
              execution_id: null,
              emitted_at: new Date().toISOString(),
              payload: {
                message: error instanceof Error ? error.message : String(error)
              }
            });
          },
          async (result) => {
            trace("assistant-bridge", "request completed", {
              requestId,
              threadId: result.thread.threadId,
              executionId: result.execution.executionId
            });
            const finalOutput =
              typeof result.finalOutput === "string" ? result.finalOutput.trim() : "";

            if (
              finalOutput.length > 0 &&
              !usedMusicControlTools(result) &&
              !requestTracker.hasTts(requestId) &&
              options.openAiTtsClient !== null
            ) {
              try {
                await emitFallbackSpeech({
                  requestId,
                  threadId: result.thread.threadId,
                  text: finalOutput,
                  eventBus,
                  spotifyClient: options.spotifyClient,
                  ttsClient: options.openAiTtsClient,
                  ttsResumePaddingMs: options.ttsResumePaddingMs
                });
              } catch (error) {
                traceError("assistant-bridge", "fallback speech failed", error, {
                  requestId,
                  threadId: result.thread.threadId
                });
                emitEvent(eventBus, {
                  type: assistantBridgeEventType.error,
                  request_id: requestId,
                  thread_id: result.thread.threadId,
                  execution_id: result.execution.executionId,
                  emitted_at: new Date().toISOString(),
                  payload: {
                    stage: "fallback_speech",
                    message: error instanceof Error ? error.message : String(error)
                  }
                });
              }
            }

            requestTracker.complete(requestId);
            emitEvent(eventBus, {
              type: assistantBridgeEventType.completed,
              request_id: requestId,
              thread_id: result.thread.threadId,
              execution_id: result.execution.executionId,
              emitted_at: new Date().toISOString(),
              payload: {
                output_text: result.finalOutput,
                status: result.execution.status
              }
            });
          }
        );

        return reply.code(202).send({
          request_id: requestId,
          trigger_id: pinnedTrigger.trigger_id,
          thread_id: route.thread.threadId,
          stream_path: assistantBridgeStreamPath
        });
      });

      app.get(assistantBridgeStreamPath, async (_request, reply) => {
        reply.hijack();
        reply.raw.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive"
        });

        const unsubscribe = eventBus.subscribe((event) => {
          if (reply.raw.writableEnded || reply.raw.destroyed) {
            return;
          }

          reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
        });
        const heartbeat = setInterval(() => {
          if (reply.raw.writableEnded || reply.raw.destroyed) {
            return;
          }

          reply.raw.write(": keepalive\n\n");
        }, 15_000);
        const cleanup = () => {
          clearInterval(heartbeat);
          unsubscribe();
        };

        reply.raw.on("close", cleanup);
        reply.raw.on("error", cleanup);
      });
    }
  };
}

function usedMusicControlTools(result: ExecutionTurnResult): boolean {
  return result.usedTools.some((tool) =>
    assistantBridgeMusicControlToolNames.has(tool.name)
  );
}

function buildTriggerRouting(
  body: AssistantBridgeRequestBody
): {
  thread_id?: string;
  subject_type?: string;
  subject_id?: string;
  allow_unbound_thread?: boolean;
} {
  if (body.thread_id) {
    return {
      thread_id: body.thread_id
    };
  }

  if (body.subject_type && body.subject_id) {
    return {
      subject_type: body.subject_type,
      subject_id: body.subject_id
    };
  }

  return {
    allow_unbound_thread: body.allow_unbound_thread ?? true
  };
}

function emitEvent(
  eventBus: AssistantBridgeEventBus,
  event: AssistantBridgeStreamEvent
): void {
  eventBus.emit(event);
}

async function emitFallbackSpeech(input: {
  requestId: string;
  threadId: string;
  text: string;
  eventBus: AssistantBridgeEventBus;
  spotifyClient: AssistantBridgeSpotifyClient | null;
  ttsClient: AssistantBridgeOpenAiTtsClient;
  ttsResumePaddingMs: number;
}): Promise<void> {
  emitEvent(input.eventBus, {
    type: assistantBridgeEventType.ttsPreparing,
    request_id: input.requestId,
    thread_id: input.threadId,
    execution_id: null,
    emitted_at: new Date().toISOString()
  });
  emitEvent(input.eventBus, {
    type: assistantBridgeEventType.processing,
    request_id: input.requestId,
    thread_id: input.threadId,
    execution_id: null,
    emitted_at: new Date().toISOString(),
    payload: {
      action: "tts_fallback_start"
    }
  });

  const audioBuffer = await input.ttsClient.synthesize(input.text);
  const mimeType = assistantBridgeAudioMimeType;
  let paused = false;

  if (input.spotifyClient !== null) {
    try {
      const pauseResult = await input.spotifyClient.pauseAndWaitForStop();
      paused = pauseResult.paused;
    } catch (error) {
      traceError("assistant-bridge", "fallback spotify pause failed", error, {
        requestId: input.requestId,
        threadId: input.threadId
      });
    }
  }

  const chunks = splitBufferIntoBase64Chunks(audioBuffer);
  const playbackMs =
    getWavDurationMs(audioBuffer) ?? estimatePlaybackMsFromText(input.text);

  for (const [index, chunkBase64] of chunks.entries()) {
    emitEvent(input.eventBus, {
      type: assistantBridgeEventType.ttsChunk,
      request_id: input.requestId,
      thread_id: input.threadId,
      execution_id: null,
      emitted_at: new Date().toISOString(),
      payload: {
        chunk_index: index,
        chunk_count: chunks.length,
        mime_type: mimeType,
        audio_base64: chunkBase64
      }
    });
  }

  emitEvent(input.eventBus, {
    type: assistantBridgeEventType.ttsDone,
    request_id: input.requestId,
    thread_id: input.threadId,
    execution_id: null,
    emitted_at: new Date().toISOString(),
    payload: {
      chunk_count: chunks.length,
      bytes: audioBuffer.length,
      mime_type: mimeType,
      playback_ms: playbackMs
    }
  });

  await delay(playbackMs + input.ttsResumePaddingMs);

  if (input.spotifyClient !== null && paused) {
    try {
      await input.spotifyClient.resumeWithFallback();
    } catch (error) {
      traceError("assistant-bridge", "fallback spotify resume failed", error, {
        requestId: input.requestId,
        threadId: input.threadId
      });
    }
  }
}
