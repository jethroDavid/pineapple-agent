import { promises as fs } from "node:fs";
import { dirname } from "node:path";

import { z } from "zod";

import type { ToolDefinition } from "../../tools/tool-definition.js";
import { traceError } from "../../utils/trace.js";
import {
  assistantBridgeAudioMimeType,
  delay,
  estimatePlaybackMsFromText,
  getWavDurationMs,
  splitBufferIntoBase64Chunks
} from "./assistant-bridge-audio.js";
import { AssistantBridgeOpenAiTtsClient } from "./assistant-bridge-openai-tts-client.js";
import {
  assistantBridgeEventType,
  type AssistantBridgeEventType,
  type AssistantBridgeStreamEvent
} from "./assistant-bridge-events.js";
import { AssistantBridgeEventBus } from "./assistant-bridge-event-bus.js";
import { AssistantBridgeRequestTracker } from "./assistant-bridge-request-tracker.js";
import {
  AssistantBridgeSpotifyClient,
  type AssistantBridgeSpotifyDevice
} from "./assistant-bridge-spotify-client.js";

const assistantBridgeStatusToolInputSchema = z.object({
  status: z.enum([
    assistantBridgeEventType.processing,
    assistantBridgeEventType.searching,
    assistantBridgeEventType.summarizing
  ])
});

const assistantBridgeStatusToolOutputSchema = z.object({
  ok: z.literal(true),
  status: z.string().min(1)
});

type AssistantBridgeStatusToolInput = z.infer<
  typeof assistantBridgeStatusToolInputSchema
>;
type AssistantBridgeStatusToolOutput = z.infer<
  typeof assistantBridgeStatusToolOutputSchema
>;

const assistantBridgeSpotifyPlayInputSchema = z.object({
  query: z.string().min(1).nullable(),
  device: z.string().min(1).nullable()
});

const assistantBridgeSpotifyPlayOutputSchema = z.object({
  ok: z.literal(true),
  mode: z.enum(["resume", "search_play"]),
  track_name: z.string().nullable(),
  track_uri: z.string().nullable(),
  artists: z.array(z.string().min(1)).nullable()
});

type AssistantBridgeSpotifyPlayInput = z.infer<
  typeof assistantBridgeSpotifyPlayInputSchema
>;
type AssistantBridgeSpotifyPlayOutput = z.infer<
  typeof assistantBridgeSpotifyPlayOutputSchema
>;

const assistantBridgeSpotifyPauseInputSchema = z.object({
  device: z.string().min(1).nullable()
});

const assistantBridgeSpotifyPauseOutputSchema = z.object({
  ok: z.literal(true)
});

type AssistantBridgeSpotifyPauseInput = z.infer<
  typeof assistantBridgeSpotifyPauseInputSchema
>;
type AssistantBridgeSpotifyPauseOutput = z.infer<
  typeof assistantBridgeSpotifyPauseOutputSchema
>;

const assistantBridgeSpotifyResumeInputSchema = z.object({
  device: z.string().min(1).nullable()
});

const assistantBridgeSpotifyResumeOutputSchema = z.object({
  ok: z.literal(true)
});

type AssistantBridgeSpotifyResumeInput = z.infer<
  typeof assistantBridgeSpotifyResumeInputSchema
>;
type AssistantBridgeSpotifyResumeOutput = z.infer<
  typeof assistantBridgeSpotifyResumeOutputSchema
>;

const assistantBridgeSpotifyDeviceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  is_active: z.boolean(),
  type: z.string().min(1).nullable()
});

const assistantBridgeSpotifyListDevicesInputSchema = z.object({
  refresh: z.boolean()
});

const assistantBridgeSpotifyListDevicesOutputSchema = z.object({
  ok: z.literal(true),
  source: z.enum(["spotify_api", "cache"]),
  cache_path: z.string().min(1),
  fetched_at: z.string().min(1),
  devices: z.array(assistantBridgeSpotifyDeviceSchema)
});

type AssistantBridgeSpotifyListDevicesInput = z.infer<
  typeof assistantBridgeSpotifyListDevicesInputSchema
>;
type AssistantBridgeSpotifyListDevicesOutput = z.infer<
  typeof assistantBridgeSpotifyListDevicesOutputSchema
>;

const assistantBridgeSpeakInputSchema = z.object({
  text: z.string().min(1),
  device: z.string().min(1).nullable()
});

const assistantBridgeSpeakOutputSchema = z.object({
  ok: z.literal(true),
  bytes: z.number().int().nonnegative(),
  chunks: z.number().int().positive()
});

type AssistantBridgeSpeakInput = z.infer<typeof assistantBridgeSpeakInputSchema>;
type AssistantBridgeSpeakOutput = z.infer<typeof assistantBridgeSpeakOutputSchema>;

interface AssistantBridgeToolOptions {
  eventBus: AssistantBridgeEventBus;
  requestTracker: AssistantBridgeRequestTracker;
  spotifyClient: AssistantBridgeSpotifyClient | null;
  openAiTtsClient: AssistantBridgeOpenAiTtsClient | null;
  ttsResumePaddingMs: number;
  spotifyDevicesCachePath: string;
}

export function createAssistantBridgeTools(
  options: AssistantBridgeToolOptions
): ToolDefinition[] {
  return [
    createAssistantBridgeEmitStatusTool(options),
    createAssistantBridgeSpotifyListDevicesTool(options),
    createAssistantBridgeSpotifyPlayTool(options),
    createAssistantBridgeSpotifyPauseTool(options),
    createAssistantBridgeSpotifyResumeTool(options),
    createAssistantBridgeSpeakOverMusicTool(options)
  ];
}

function createAssistantBridgeEmitStatusTool(
  options: AssistantBridgeToolOptions
): ToolDefinition<
  AssistantBridgeStatusToolInput,
  AssistantBridgeStatusToolOutput
> {
  return {
    name: "assistant_bridge_emit_status",
    description:
      "Emit a lifecycle status event for the local assistant stream (processing/searching/summarizing).",
    inputSchema: assistantBridgeStatusToolInputSchema,
    outputSchema: assistantBridgeStatusToolOutputSchema,
    sideEffecting: false,
    approvalRequired: false,
    idempotent: false,
    async execute(input, context) {
      const threadId = context?.threadId;

      if (!threadId) {
        throw new Error("assistant_bridge_emit_status requires a threadId context.");
      }

      emitAssistantBridgeEvent(options, threadId, input.status);

      return {
        ok: true,
        status: input.status
      };
    }
  };
}

function createAssistantBridgeSpotifyListDevicesTool(
  options: AssistantBridgeToolOptions
): ToolDefinition<
  AssistantBridgeSpotifyListDevicesInput,
  AssistantBridgeSpotifyListDevicesOutput
> {
  return {
    name: "assistant_bridge_spotify_list_devices",
    description:
      "List available Spotify playback devices and persist them to the assistant bridge device cache. Set refresh=true to fetch from Spotify API, or refresh=false to read cached devices first.",
    inputSchema: assistantBridgeSpotifyListDevicesInputSchema,
    outputSchema: assistantBridgeSpotifyListDevicesOutputSchema,
    sideEffecting: false,
    approvalRequired: false,
    idempotent: false,
    async execute(input, context) {
      const spotifyClient = requireSpotifyClient(options.spotifyClient);
      const shouldRefresh = input.refresh;
      const cached = await readSpotifyDeviceCache(options.spotifyDevicesCachePath);
      const threadId = context?.threadId ?? null;

      if (shouldRefresh) {
        try {
          const refreshed = await spotifyClient.listDevices();
          const payload = {
            fetched_at: new Date().toISOString(),
            devices: refreshed.map(toAssistantBridgeDevicePayload)
          };

          await writeSpotifyDeviceCache(options.spotifyDevicesCachePath, payload);
          emitAssistantBridgeEvent(options, threadId, assistantBridgeEventType.processing, {
            action: "spotify_list_devices_refreshed",
            count: payload.devices.length
          });

          return {
            ok: true,
            source: "spotify_api",
            cache_path: options.spotifyDevicesCachePath,
            fetched_at: payload.fetched_at,
            devices: payload.devices
          };
        } catch (error) {
          if (cached !== null) {
            emitAssistantBridgeEvent(options, threadId, assistantBridgeEventType.processing, {
              action: "spotify_list_devices_cache_fallback",
              count: cached.devices.length
            });
            return {
              ok: true,
              source: "cache",
              cache_path: options.spotifyDevicesCachePath,
              fetched_at: cached.fetched_at,
              devices: cached.devices
            };
          }

          throw augmentSpotifyDeviceError(error);
        }
      }

      if (cached !== null) {
        emitAssistantBridgeEvent(options, threadId, assistantBridgeEventType.processing, {
          action: "spotify_list_devices_cache",
          count: cached.devices.length
        });
        return {
          ok: true,
          source: "cache",
          cache_path: options.spotifyDevicesCachePath,
          fetched_at: cached.fetched_at,
          devices: cached.devices
        };
      }

      const refreshed = await spotifyClient.listDevices();
      const payload = {
        fetched_at: new Date().toISOString(),
        devices: refreshed.map(toAssistantBridgeDevicePayload)
      };

      await writeSpotifyDeviceCache(options.spotifyDevicesCachePath, payload);
      emitAssistantBridgeEvent(options, threadId, assistantBridgeEventType.processing, {
        action: "spotify_list_devices_refreshed",
        count: payload.devices.length
      });

      return {
        ok: true,
        source: "spotify_api",
        cache_path: options.spotifyDevicesCachePath,
        fetched_at: payload.fetched_at,
        devices: payload.devices
      };
    }
  };
}

function createAssistantBridgeSpotifyPlayTool(
  options: AssistantBridgeToolOptions
): ToolDefinition<
  AssistantBridgeSpotifyPlayInput,
  AssistantBridgeSpotifyPlayOutput
> {
  return {
    name: "assistant_bridge_spotify_play",
    description:
      "Resume Spotify playback, or search and play a track when query is provided.",
    inputSchema: assistantBridgeSpotifyPlayInputSchema,
    outputSchema: assistantBridgeSpotifyPlayOutputSchema,
    sideEffecting: true,
    approvalRequired: false,
    idempotent: false,
    async execute(input, context) {
      const spotifyClient = requireSpotifyClient(options.spotifyClient);
      const threadId = context?.threadId ?? null;
      const deviceHint = input.device ?? undefined;

      try {
        if (input.query) {
          const track = await spotifyClient.playFromQuery(input.query, deviceHint);
          emitAssistantBridgeEvent(options, threadId, assistantBridgeEventType.processing, {
            action: "spotify_play_query",
            track_name: track.name
          });

          return {
            ok: true,
            mode: "search_play",
            track_name: track.name,
            track_uri: track.uri,
            artists: track.artists
          };
        }

        await spotifyClient.resume(deviceHint);
        emitAssistantBridgeEvent(options, threadId, assistantBridgeEventType.processing, {
          action: "spotify_resume"
        });

        return {
          ok: true,
          mode: "resume",
          track_name: null,
          track_uri: null,
          artists: null
        };
      } catch (error) {
        throw augmentSpotifyDeviceError(error);
      }
    }
  };
}

function createAssistantBridgeSpotifyPauseTool(
  options: AssistantBridgeToolOptions
): ToolDefinition<
  AssistantBridgeSpotifyPauseInput,
  AssistantBridgeSpotifyPauseOutput
> {
  return {
    name: "assistant_bridge_spotify_pause",
    description: "Pause Spotify playback.",
    inputSchema: assistantBridgeSpotifyPauseInputSchema,
    outputSchema: assistantBridgeSpotifyPauseOutputSchema,
    sideEffecting: true,
    approvalRequired: false,
    idempotent: false,
    async execute(input, context) {
      const spotifyClient = requireSpotifyClient(options.spotifyClient);
      const deviceHint = input.device ?? undefined;
      let pauseResult: {
        paused: boolean;
        targetDeviceId?: string;
      };

      try {
        pauseResult = await spotifyClient.pauseAndWaitForStop(deviceHint);
      } catch (error) {
        throw augmentSpotifyDeviceError(error);
      }

      if (!pauseResult.paused) {
        throw new Error("Spotify pause command did not take effect.");
      }

      emitAssistantBridgeEvent(
        options,
        context?.threadId ?? null,
        assistantBridgeEventType.processing,
        {
          action: "spotify_pause"
        }
      );

      return {
        ok: true
      };
    }
  };
}

function createAssistantBridgeSpotifyResumeTool(
  options: AssistantBridgeToolOptions
): ToolDefinition<
  AssistantBridgeSpotifyResumeInput,
  AssistantBridgeSpotifyResumeOutput
> {
  return {
    name: "assistant_bridge_spotify_resume",
    description: "Resume Spotify playback.",
    inputSchema: assistantBridgeSpotifyResumeInputSchema,
    outputSchema: assistantBridgeSpotifyResumeOutputSchema,
    sideEffecting: true,
    approvalRequired: false,
    idempotent: false,
    async execute(input, context) {
      const spotifyClient = requireSpotifyClient(options.spotifyClient);
      const deviceHint = input.device ?? undefined;

      try {
        await spotifyClient.resumeWithFallback(deviceHint);
      } catch (error) {
        throw augmentSpotifyDeviceError(error);
      }

      emitAssistantBridgeEvent(
        options,
        context?.threadId ?? null,
        assistantBridgeEventType.processing,
        {
          action: "spotify_resume"
        }
      );

      return {
        ok: true
      };
    }
  };
}

function createAssistantBridgeSpeakOverMusicTool(
  options: AssistantBridgeToolOptions
): ToolDefinition<AssistantBridgeSpeakInput, AssistantBridgeSpeakOutput> {
  return {
    name: "assistant_bridge_speak_over_music",
    description:
      "Prepare OpenAI TTS while music continues, then pause Spotify, emit audio chunks to stream, and resume Spotify.",
    inputSchema: assistantBridgeSpeakInputSchema,
    outputSchema: assistantBridgeSpeakOutputSchema,
    sideEffecting: true,
    approvalRequired: false,
    idempotent: false,
    async execute(input, context) {
      const ttsClient = requireOpenAiTtsClient(options.openAiTtsClient);
      const spotifyClient = requireSpotifyClient(options.spotifyClient);
      const threadId = context?.threadId;
      const deviceHint = input.device ?? undefined;
      let resumeDeviceHint = deviceHint;

      if (!threadId) {
        throw new Error("assistant_bridge_speak_over_music requires a threadId context.");
      }

      emitAssistantBridgeEvent(
        options,
        threadId,
        assistantBridgeEventType.ttsPreparing
      );

      let paused = false;

      try {
        emitAssistantBridgeEvent(
          options,
          threadId,
          assistantBridgeEventType.processing,
          {
            action: "tts_synthesize_start"
          }
        );
        const audioBuffer = await ttsClient.synthesize(input.text);
        emitAssistantBridgeEvent(
          options,
          threadId,
          assistantBridgeEventType.processing,
          {
            action: "tts_synthesize_success",
            bytes: audioBuffer.length
          }
        );
        emitAssistantBridgeEvent(
          options,
          threadId,
          assistantBridgeEventType.processing,
          {
            action: "spotify_pause_attempt"
          }
        );
        const pauseResult = await spotifyClient.pauseAndWaitForStop(deviceHint);

        if (!pauseResult.paused) {
          throw new Error(
            "Spotify pause command did not take effect before TTS playback."
          );
        }

        paused = true;
        resumeDeviceHint = pauseResult.targetDeviceId ?? deviceHint;
        emitAssistantBridgeEvent(
          options,
          threadId,
          assistantBridgeEventType.processing,
          {
            action: "spotify_pause_success",
            target_device_id: resumeDeviceHint ?? null
          }
        );
        const mimeType = assistantBridgeAudioMimeType;
        const chunks = splitBufferIntoBase64Chunks(audioBuffer);
        const playbackMs =
          getWavDurationMs(audioBuffer) ?? estimatePlaybackMsFromText(input.text);

        for (const [index, chunkBase64] of chunks.entries()) {
          emitAssistantBridgeEvent(
            options,
            threadId,
            assistantBridgeEventType.ttsChunk,
            {
              chunk_index: index,
              chunk_count: chunks.length,
              mime_type: mimeType,
              audio_base64: chunkBase64
            }
          );
        }

        emitAssistantBridgeEvent(options, threadId, assistantBridgeEventType.ttsDone, {
          chunk_count: chunks.length,
          bytes: audioBuffer.length,
          mime_type: mimeType,
          playback_ms: playbackMs
        });

        emitAssistantBridgeEvent(
          options,
          threadId,
          assistantBridgeEventType.processing,
          {
            action: "tts_wait_playback",
            playback_ms: playbackMs,
            resume_padding_ms: options.ttsResumePaddingMs
          }
        );
        await delay(playbackMs + options.ttsResumePaddingMs);
        emitAssistantBridgeEvent(
          options,
          threadId,
          assistantBridgeEventType.processing,
          {
            action: "spotify_resume_attempt"
          }
        );
        await spotifyClient.resumeWithFallback(resumeDeviceHint);
        emitAssistantBridgeEvent(
          options,
          threadId,
          assistantBridgeEventType.processing,
          {
            action: "spotify_resume_success"
          }
        );
        paused = false;

        return {
          ok: true,
          bytes: audioBuffer.length,
          chunks: chunks.length
        };
      } catch (error) {
        traceError("assistant-bridge", "speak_over_music failed", error, {
          threadId
        });
        emitAssistantBridgeEvent(options, threadId, assistantBridgeEventType.error, {
          stage: "speak_over_music",
          message: error instanceof Error ? error.message : String(error)
        });
        throw augmentSpotifyDeviceError(error);
      } finally {
        if (paused) {
          try {
            await spotifyClient.resumeWithFallback(resumeDeviceHint);
          } catch (resumeError) {
            traceError("assistant-bridge", "spotify resume failed after TTS error", resumeError, {
              threadId
            });
          }
        }
      }
    }
  };
}

function emitAssistantBridgeEvent(
  options: AssistantBridgeToolOptions,
  threadId: string | null,
  type: AssistantBridgeEventType,
  payload?: Record<string, unknown>
): void {
  const requestId =
    threadId === null ? null : options.requestTracker.peekByThreadId(threadId);
  const event: AssistantBridgeStreamEvent = {
    type,
    request_id: requestId,
    thread_id: threadId,
    execution_id: null,
    emitted_at: new Date().toISOString(),
    ...(payload === undefined ? {} : { payload })
  };

  options.eventBus.emit(event);
}

const assistantBridgeSpotifyDeviceCacheSchema = z.object({
  fetched_at: z.string().min(1),
  devices: z.array(assistantBridgeSpotifyDeviceSchema)
});

type AssistantBridgeSpotifyDeviceCache = z.infer<
  typeof assistantBridgeSpotifyDeviceCacheSchema
>;

function toAssistantBridgeDevicePayload(
  device: AssistantBridgeSpotifyDevice
): z.infer<typeof assistantBridgeSpotifyDeviceSchema> {
  return {
    id: device.id,
    name: device.name,
    is_active: device.isActive,
    type: device.type
  };
}

async function readSpotifyDeviceCache(
  cachePath: string
): Promise<AssistantBridgeSpotifyDeviceCache | null> {
  try {
    const raw = await fs.readFile(cachePath, "utf8");
    return assistantBridgeSpotifyDeviceCacheSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

async function writeSpotifyDeviceCache(
  cachePath: string,
  cache: AssistantBridgeSpotifyDeviceCache
): Promise<void> {
  await fs.mkdir(dirname(cachePath), {
    recursive: true
  });
  await fs.writeFile(cachePath, `${JSON.stringify(cache, null, 2)}\n`, {
    encoding: "utf8"
  });
}

function augmentSpotifyDeviceError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);

  if (!message.toLowerCase().includes("device")) {
    return error instanceof Error ? error : new Error(message);
  }

  return new Error(
    `${message} Call assistant_bridge_spotify_list_devices with refresh=true, then retry with a concrete device id.`
  );
}

function requireSpotifyClient(
  client: AssistantBridgeSpotifyClient | null
): AssistantBridgeSpotifyClient {
  if (client === null) {
    throw new Error(
      "Assistant bridge Spotify client is not configured. Set ASSISTANT_BRIDGE_SPOTIFY_CLIENT_ID and ASSISTANT_BRIDGE_SPOTIFY_TOKEN_FILE."
    );
  }

  return client;
}

function requireOpenAiTtsClient(
  client: AssistantBridgeOpenAiTtsClient | null
): AssistantBridgeOpenAiTtsClient {
  if (client === null) {
    throw new Error(
      "Assistant bridge OpenAI TTS client is not configured. Set OPENAI_API_KEY."
    );
  }

  return client;
}
