import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { AppAdapter, AppAdapterRouteContext } from "../app-adapter.js";
import type { ThreadStore } from "../../threads/store/thread-store.js";
import { createTriggerEvent, triggerActorType, triggerSourceKind } from "../../execution/contracts/trigger-event.js";
import { routeTriggerEvent } from "../../execution/routing/route-trigger-event.js";
import { trace, traceError } from "../../utils/trace.js";
import {
  assistantAudioBridgeAudioMimeType,
  getWavDurationMs,
  normalizeWavBuffer
} from "./assistant-audio-bridge-audio.js";
import {
  AssistantAudioBridgeRequestStore,
  assistantAudioBridgeRequestStatus
} from "./assistant-audio-bridge-request-store.js";
import { AssistantAudioBridgeSpotifyClient } from "./assistant-audio-bridge-spotify-client.js";
import { createAssistantAudioBridgeSpotifyTools } from "./assistant-audio-bridge-spotify-tools.js";

const assistantAudioBridgeRequestSchema = z
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

type AssistantAudioBridgeRequestBody = z.infer<typeof assistantAudioBridgeRequestSchema>;

export interface AssistantAudioBridgeTtsClient {
  synthesize(text: string): Promise<Buffer>;
}

export interface AssistantAudioBridgeAdapterOptions {
  enabled: boolean;
  threadStore: ThreadStore;
  agentId: string;
  defaultActorId: string;
  ttsClient: AssistantAudioBridgeTtsClient | null;
  spotifyClient: AssistantAudioBridgeSpotifyClient | null;
  spotifyDeviceCachePath: string;
  ttsResumePaddingMs: number;
  audioArtifactDir: string | null;
  requestTtlMs: number;
}

const assistantAudioBridgeRequestPath = "/adapters/assistant-audio-bridge/requests";
const assistantAudioBridgeStatusPath = "/adapters/assistant-audio-bridge/requests/:requestId";
const assistantAudioBridgeAudioPath = "/adapters/assistant-audio-bridge/requests/:requestId/audio";
const assistantAudioBridgePlaybackCompletePath =
  "/adapters/assistant-audio-bridge/requests/:requestId/playback-complete";
const assistantAudioBridgeHttpChunkSizeBytes = 16 * 1024;
const playbackAckGraceMs = 1_000;
const unknownAudioDurationFallbackMs = 20_000;

interface PendingSpotifyResume {
  requestId: string;
  spotifyClient: AssistantAudioBridgeSpotifyClient;
  deviceHint?: string;
  timeout: NodeJS.Timeout;
}

export function createAssistantAudioBridgeAdapter(
  options: AssistantAudioBridgeAdapterOptions
): AppAdapter | null {
  if (!options.enabled) {
    return null;
  }

  const requestStore = new AssistantAudioBridgeRequestStore(options.requestTtlMs);
  let executionContext: AppAdapterRouteContext["execution"] = null;
  const pendingSpotifyResumes = new Map<string, PendingSpotifyResume>();

  const triggerSpotifyResume = async (
    requestId: string,
    reason: "playback_complete" | "timeout_fallback" | "stream_failure"
  ): Promise<boolean> => {
    const pending = pendingSpotifyResumes.get(requestId);

    if (!pending) {
      return false;
    }

    pendingSpotifyResumes.delete(requestId);
    clearTimeout(pending.timeout);

    try {
      await pending.spotifyClient.resumeWithFallback(pending.deviceHint);
      trace("assistant-audio-bridge", "spotify resume success", {
        requestId,
        reason
      });
      return true;
    } catch (error) {
      traceError("assistant-audio-bridge", "spotify resume failed", error, {
        requestId,
        reason
      });
      return false;
    }
  };

  const queueSpotifyResumeFallback = (input: {
    requestId: string;
    spotifyClient: AssistantAudioBridgeSpotifyClient | null;
    deviceHint?: string;
    fallbackDelayMs: number;
  }): void => {
    if (input.spotifyClient === null) {
      return;
    }

    const existing = pendingSpotifyResumes.get(input.requestId);
    if (existing) {
      clearTimeout(existing.timeout);
      pendingSpotifyResumes.delete(input.requestId);
    }

    const timeout = setTimeout(() => {
      void triggerSpotifyResume(input.requestId, "timeout_fallback");
    }, input.fallbackDelayMs);
    timeout.unref();

    pendingSpotifyResumes.set(input.requestId, {
      requestId: input.requestId,
      spotifyClient: input.spotifyClient,
      deviceHint: input.deviceHint,
      timeout
    });
  };

  return {
    name: "assistant_audio_bridge",
    getTools() {
      return createAssistantAudioBridgeSpotifyTools({
        spotifyClient: options.spotifyClient,
        spotifyDevicesCachePath: options.spotifyDeviceCachePath
      });
    },
    registerRoutes(app: FastifyInstance, context: AppAdapterRouteContext) {
      executionContext = context.execution;

      app.post(assistantAudioBridgeRequestPath, async (request, reply) => {
        if (executionContext === null) {
          return reply.code(503).send({
            error: "Execution service is not configured."
          });
        }

        const ttsClient = options.ttsClient;

        if (ttsClient === null) {
          return reply.code(503).send({
            error: "OpenAI TTS is not configured. Set OPENAI_API_KEY."
          });
        }

        const body = assistantAudioBridgeRequestSchema.parse(request.body);
        const requestId = body.request_id ?? randomUUID();
        const actorId = body.actor_id ?? options.defaultActorId;
        const provisionalTrigger = createTriggerEvent({
          trigger_id: `assistant-audio-bridge:request:${requestId}`,
          source: {
            kind: triggerSourceKind.http,
            system: "assistant_audio_bridge",
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

        requestStore.create({
          requestId,
          threadId: route.thread.threadId,
          text: body.text.trim()
        });

        executionContext.enqueueTrigger(
          pinnedTrigger,
          (error) => {
            traceError("assistant-audio-bridge", "request failed", error, {
              requestId,
              threadId: route.thread.threadId
            });
            requestStore.markError(requestId, {
              executionId: null,
              message: error instanceof Error ? error.message : String(error)
            });
          },
          async (result) => {
            const executionId = result.execution.executionId;
            requestStore.markProcessing(requestId, executionId);
            trace("assistant-audio-bridge", "request processing", {
              requestId,
              threadId: route.thread.threadId,
              executionId
            });

            const finalOutput =
              typeof result.finalOutput === "string" ? result.finalOutput.trim() : "";

            if (finalOutput.length === 0) {
              requestStore.markError(requestId, {
                executionId,
                message: "Assistant returned empty output.",
                outputText: null
              });
              return;
            }

            try {
              const audioBuffer = normalizeWavBuffer(
                await ttsClient.synthesize(finalOutput)
              );
              await writeAudioArtifact({
                dir: options.audioArtifactDir,
                requestId,
                audioBuffer
              });
              requestStore.markReady(requestId, {
                executionId,
                outputText: finalOutput,
                mimeType: assistantAudioBridgeAudioMimeType,
                audioBuffer
              });
              trace("assistant-audio-bridge", "audio ready", {
                requestId,
                threadId: route.thread.threadId,
                executionId,
                bytes: audioBuffer.length
              });
            } catch (error) {
              traceError("assistant-audio-bridge", "tts failed", error, {
                requestId,
                threadId: route.thread.threadId,
                executionId
              });
              requestStore.markError(requestId, {
                executionId,
                message: error instanceof Error ? error.message : String(error),
                outputText: finalOutput
              });
            }
          }
        );

        return reply.code(202).send({
          request_id: requestId,
          thread_id: route.thread.threadId,
          status: assistantAudioBridgeRequestStatus.queued,
          status_path: `${assistantAudioBridgeRequestPath}/${requestId}`,
          audio_path: `${assistantAudioBridgeRequestPath}/${requestId}/audio`
        });
      });

      app.get(assistantAudioBridgeStatusPath, async (request, reply) => {
        const requestId = getRequestId(request.params);
        const snapshot = requestStore.getSnapshot(requestId);

        if (!snapshot) {
          return reply.code(404).send({
            error: "Audio bridge request was not found."
          });
        }

        return snapshot;
      });

      app.get(assistantAudioBridgeAudioPath, async (request, reply) => {
        const requestId = getRequestId(request.params);
        const snapshot = requestStore.getSnapshot(requestId);

        if (!snapshot) {
          return reply.code(404).send({
            error: "Audio bridge request was not found."
          });
        }

        if (snapshot.status === assistantAudioBridgeRequestStatus.error) {
          return reply.code(409).send({
            error: "Audio is unavailable.",
            message: snapshot.error_message ?? "Unknown request failure."
          });
        }

        const payload = requestStore.getAudioPayload(requestId);

        if (!payload) {
          return reply.code(409).send({
            error: "Audio is not ready yet.",
            status: snapshot.status
          });
        }

        const spotifyPause = await pauseSpotifyForAudioStream({
          requestId,
          spotifyClient: options.spotifyClient
        });
        const playbackMs =
          getWavDurationMs(payload.audioBuffer) ?? unknownAudioDurationFallbackMs;
        requestStore.markStreaming(requestId);
        reply.hijack();
        reply.raw.writeHead(200, {
          "content-type": payload.mimeType,
          "cache-control": "no-store",
          "content-length": payload.audioBuffer.length
        });

        try {
          for (const chunk of splitBuffer(payload.audioBuffer)) {
            if (reply.raw.destroyed || reply.raw.writableEnded) {
              break;
            }

            reply.raw.write(chunk);
          }

          if (!reply.raw.destroyed && !reply.raw.writableEnded) {
            reply.raw.end();
          }
          requestStore.markCompleted(requestId);
          if (spotifyPause.paused) {
            queueSpotifyResumeFallback({
              requestId,
              spotifyClient: options.spotifyClient,
              deviceHint: spotifyPause.targetDeviceId,
              fallbackDelayMs:
                playbackMs + options.ttsResumePaddingMs + playbackAckGraceMs
            });
          }
        } catch (error) {
          traceError("assistant-audio-bridge", "audio stream failed", error, {
            requestId
          });
          requestStore.markError(requestId, {
            executionId: snapshot.execution_id,
            message: error instanceof Error ? error.message : String(error),
            outputText: snapshot.output_text
          });
          if (!reply.raw.destroyed) {
            reply.raw.destroy(error instanceof Error ? error : new Error(String(error)));
          }

          if (spotifyPause.paused) {
            await resumeSpotifyNow({
              requestId,
              spotifyClient: options.spotifyClient,
              deviceHint: spotifyPause.targetDeviceId,
              reason: "stream_failure"
            });
          }
        }
      });

      app.post(assistantAudioBridgePlaybackCompletePath, async (request, reply) => {
        const requestId = getRequestId(request.params);
        const snapshot = requestStore.getSnapshot(requestId);

        if (!snapshot) {
          return reply.code(404).send({
            error: "Audio bridge request was not found."
          });
        }

        const resumed = await triggerSpotifyResume(requestId, "playback_complete");

        return reply.send({
          request_id: requestId,
          status: snapshot.status,
          spotify_resume_triggered: resumed
        });
      });
    }
  };
}

async function pauseSpotifyForAudioStream(options: {
  requestId: string;
  spotifyClient: AssistantAudioBridgeSpotifyClient | null;
}): Promise<{
  paused: boolean;
  targetDeviceId?: string;
}> {
  if (options.spotifyClient === null) {
    return {
      paused: false
    };
  }

  try {
    trace("assistant-audio-bridge", "spotify pause attempt", {
      requestId: options.requestId
    });
    const result = await options.spotifyClient.pauseAndWaitForStop();

    if (!result.paused) {
      trace("assistant-audio-bridge", "spotify pause did not take effect", {
        requestId: options.requestId,
        targetDeviceId: result.targetDeviceId ?? null
      });
      return {
        paused: false,
        targetDeviceId: result.targetDeviceId
      };
    }

    trace("assistant-audio-bridge", "spotify pause success", {
      requestId: options.requestId,
      targetDeviceId: result.targetDeviceId ?? null
    });
    return result;
  } catch (error) {
    traceError("assistant-audio-bridge", "spotify pause failed", error, {
      requestId: options.requestId
    });
    return {
      paused: false
    };
  }
}

async function resumeSpotifyNow(options: {
  requestId: string;
  spotifyClient: AssistantAudioBridgeSpotifyClient | null;
  deviceHint?: string;
  reason: "stream_failure";
}): Promise<void> {
  if (options.spotifyClient === null) {
    return;
  }

  try {
    await options.spotifyClient.resumeWithFallback(options.deviceHint);
    trace("assistant-audio-bridge", "spotify resume success", {
      requestId: options.requestId,
      reason: options.reason
    });
  } catch (error) {
    traceError("assistant-audio-bridge", "spotify resume failed", error, {
      requestId: options.requestId,
      reason: options.reason
    });
  }
}

async function writeAudioArtifact(options: {
  dir: string | null;
  requestId: string;
  audioBuffer: Buffer;
}): Promise<void> {
  if (options.dir === null) {
    return;
  }

  await mkdir(options.dir, {
    recursive: true
  });
  await writeFile(join(options.dir, `${options.requestId}.wav`), options.audioBuffer);
}

function buildTriggerRouting(
  body: AssistantAudioBridgeRequestBody
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

function splitBuffer(buffer: Buffer): Buffer[] {
  const chunks: Buffer[] = [];

  for (let start = 0; start < buffer.length; start += assistantAudioBridgeHttpChunkSizeBytes) {
    const end = Math.min(start + assistantAudioBridgeHttpChunkSizeBytes, buffer.length);
    chunks.push(buffer.subarray(start, end));
  }

  return chunks;
}

function getRequestId(params: unknown): string {
  const parsed = z
    .object({
      requestId: z.string().min(1)
    })
    .parse(params);

  return parsed.requestId;
}
