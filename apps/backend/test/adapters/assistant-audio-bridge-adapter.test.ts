import { afterEach, describe, expect, it } from "vitest";

import { normalizeWavBuffer } from "../../src/adapters/assistant-audio-bridge/assistant-audio-bridge-audio.js";
import {
  createAssistantAudioBridgeAdapter,
  type AssistantAudioBridgeTtsClient
} from "../../src/adapters/assistant-audio-bridge/assistant-audio-bridge-adapter.js";
import { assistantAudioBridgeRequestStatus } from "../../src/adapters/assistant-audio-bridge/assistant-audio-bridge-request-store.js";
import type { AssistantAudioBridgeSpotifyClient } from "../../src/adapters/assistant-audio-bridge/assistant-audio-bridge-spotify-client.js";
import { buildApp } from "../../src/entrypoints/http/server.js";
import type { ExecutionTurnResult } from "../../src/execution/execution-contracts.js";
import type { AppExecutionService } from "../../src/execution/pipeline/service.js";
import { InMemoryThreadStore } from "../support/in-memory-thread-store.js";

describe("assistant audio bridge adapter", () => {
  const apps: ReturnType<typeof buildApp>[] = [];

  afterEach(async () => {
    while (apps.length > 0) {
      const app = apps.pop();
      await app?.close();
    }
  });

  it("returns 400 for invalid request payloads", async () => {
    const harness = createExecutionHarness();
    const app = createTestApp({
      execution: harness.executionService,
      ttsClient: createImmediateTtsClient(createWavLikeBuffer("ok"))
    });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/adapters/assistant-audio-bridge/requests",
      payload: {
        text: ""
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: "Invalid request payload."
    });
  });

  it("accepts requests and starts in queued status", async () => {
    const harness = createExecutionHarness();
    const app = createTestApp({
      execution: harness.executionService,
      ttsClient: createImmediateTtsClient(createWavLikeBuffer("queued"))
    });
    apps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/adapters/assistant-audio-bridge/requests",
      payload: {
        text: "hello world"
      }
    });

    expect(response.statusCode).toBe(202);
    const body = response.json();
    expect(body.status).toBe(assistantAudioBridgeRequestStatus.queued);
    expect(typeof body.request_id).toBe("string");
    expect(body.status_path).toBe(
      `/adapters/assistant-audio-bridge/requests/${body.request_id}`
    );
    expect(body.audio_path).toBe(
      `/adapters/assistant-audio-bridge/requests/${body.request_id}/audio`
    );

    const queuedStatus = await app.inject({
      method: "GET",
      url: body.status_path
    });
    expect(queuedStatus.statusCode).toBe(200);
    expect(queuedStatus.json()).toMatchObject({
      request_id: body.request_id,
      status: assistantAudioBridgeRequestStatus.queued
    });
  });

  it("transitions queued -> processing -> ready -> completed and streams audio", async () => {
    const harness = createExecutionHarness();
    const deferredTts = createDeferredTtsClient();
    const app = createTestApp({
      execution: harness.executionService,
      ttsClient: deferredTts.client
    });
    apps.push(app);

    const requestResponse = await app.inject({
      method: "POST",
      url: "/adapters/assistant-audio-bridge/requests",
      payload: {
        text: "status transitions"
      }
    });
    const requestBody = requestResponse.json();
    const requestId = requestBody.request_id as string;

    expect(await fetchStatus(app, requestId)).toBe(
      assistantAudioBridgeRequestStatus.queued
    );

    void harness.completeWithOutput({
      requestId,
      finalOutput: "This will be spoken."
    });

    await waitForStatus(app, requestId, assistantAudioBridgeRequestStatus.processing);
    deferredTts.resolve(createWavLikeBuffer("audio"));
    await waitForStatus(app, requestId, assistantAudioBridgeRequestStatus.ready);

    const audioResponse = await app.inject({
      method: "GET",
      url: `/adapters/assistant-audio-bridge/requests/${requestId}/audio`
    });
    expect(audioResponse.statusCode).toBe(200);
    expect(audioResponse.headers["content-type"]).toContain("audio/wav");
    expect(audioResponse.rawPayload.length).toBeGreaterThan(0);

    await waitForStatus(app, requestId, assistantAudioBridgeRequestStatus.completed);
  });

  it("normalizes streaming WAV headers into finite WAV files", () => {
    const buffer = createStreamingWavBuffer();
    buffer.writeUInt32LE(0xffffffff, 4);
    buffer.writeUInt32LE(0xffffffff, 40);

    const normalized = normalizeWavBuffer(buffer);

    expect(normalized.readUInt32LE(4)).toBe(normalized.length - 8);
    expect(normalized.readUInt32LE(40)).toBe(normalized.length - 44);
  });

  it("registers restored Spotify tools on the active audio bridge adapter", async () => {
    const harness = createExecutionHarness();
    const adapter = createAssistantAudioBridgeAdapter({
      enabled: true,
      threadStore: new InMemoryThreadStore(),
      agentId: "assistant_audio_bridge",
      defaultActorId: "mobile-test",
      ttsClient: createImmediateTtsClient(createWavLikeBuffer("tools")),
      spotifyClient: createFakeSpotifyClient(),
      spotifyDeviceCachePath: "spotify-devices-test.json",
      ttsResumePaddingMs: 1,
      audioArtifactDir: null,
      requestTtlMs: 60_000
    });

    expect(adapter).not.toBeNull();
    expect(adapter?.getTools().map((tool) => tool.name)).toEqual([
      "assistant_bridge_spotify_list_devices",
      "assistant_bridge_spotify_play",
      "assistant_bridge_spotify_pause",
      "assistant_bridge_spotify_resume",
      "assistant_bridge_spotify_list_playlists",
      "assistant_bridge_spotify_add_tracks_to_playlist",
      "assistant_bridge_spotify_play_playlist"
    ]);

    const app = buildApp({
      adapters: [adapter!],
      execution: harness.executionService
    });
    apps.push(app);
  });

  it("resumes Spotify when playback completion is acknowledged", async () => {
    const harness = createExecutionHarness();
    const spotify = createFakeSpotifyClientHarness();
    const app = createTestApp({
      execution: harness.executionService,
      ttsClient: createImmediateTtsClient(createStreamingWavBuffer()),
      spotifyClient: spotify.client,
      ttsResumePaddingMs: 30_000
    });
    apps.push(app);

    const requestResponse = await app.inject({
      method: "POST",
      url: "/adapters/assistant-audio-bridge/requests",
      payload: {
        text: "resume on ack"
      }
    });
    const requestId = requestResponse.json().request_id as string;

    void harness.completeWithOutput({
      requestId,
      finalOutput: "Ack test output."
    });
    await waitForStatus(app, requestId, assistantAudioBridgeRequestStatus.ready);

    const audioResponse = await app.inject({
      method: "GET",
      url: `/adapters/assistant-audio-bridge/requests/${requestId}/audio`
    });
    expect(audioResponse.statusCode).toBe(200);
    expect(spotify.getResumeCalls()).toBe(0);

    const ackResponse = await app.inject({
      method: "POST",
      url: `/adapters/assistant-audio-bridge/requests/${requestId}/playback-complete`
    });
    expect(ackResponse.statusCode).toBe(200);
    expect(ackResponse.json()).toMatchObject({
      request_id: requestId,
      spotify_resume_triggered: true
    });

    await waitForCondition(() => spotify.getResumeCalls() === 1, 800);
  });

  it("falls back to timed Spotify resume when playback completion is not acknowledged", async () => {
    const harness = createExecutionHarness();
    const spotify = createFakeSpotifyClientHarness();
    const app = createTestApp({
      execution: harness.executionService,
      ttsClient: createImmediateTtsClient(createStreamingWavBuffer()),
      spotifyClient: spotify.client,
      ttsResumePaddingMs: 0
    });
    apps.push(app);

    const requestResponse = await app.inject({
      method: "POST",
      url: "/adapters/assistant-audio-bridge/requests",
      payload: {
        text: "resume on timeout"
      }
    });
    const requestId = requestResponse.json().request_id as string;

    void harness.completeWithOutput({
      requestId,
      finalOutput: "Timeout fallback output."
    });
    await waitForStatus(app, requestId, assistantAudioBridgeRequestStatus.ready);

    const audioResponse = await app.inject({
      method: "GET",
      url: `/adapters/assistant-audio-bridge/requests/${requestId}/audio`
    });
    expect(audioResponse.statusCode).toBe(200);
    expect(spotify.getResumeCalls()).toBe(0);

    await waitForCondition(() => spotify.getResumeCalls() === 1, 2_600);
  });

  it("marks request as error when tts fails and blocks audio download", async () => {
    const harness = createExecutionHarness();
    const deferredTts = createDeferredTtsClient();
    const app = createTestApp({
      execution: harness.executionService,
      ttsClient: deferredTts.client
    });
    apps.push(app);

    const requestResponse = await app.inject({
      method: "POST",
      url: "/adapters/assistant-audio-bridge/requests",
      payload: {
        text: "trigger error"
      }
    });
    const requestId = requestResponse.json().request_id as string;

    void harness.completeWithOutput({
      requestId,
      finalOutput: "This will fail."
    });
    await waitForStatus(app, requestId, assistantAudioBridgeRequestStatus.processing);
    deferredTts.reject(new Error("tts unavailable"));
    await waitForStatus(app, requestId, assistantAudioBridgeRequestStatus.error);

    const audioResponse = await app.inject({
      method: "GET",
      url: `/adapters/assistant-audio-bridge/requests/${requestId}/audio`
    });
    expect(audioResponse.statusCode).toBe(409);
    expect(audioResponse.json()).toMatchObject({
      error: "Audio is unavailable."
    });
  });

  it("returns 404 for unknown request ids", async () => {
    const harness = createExecutionHarness();
    const app = createTestApp({
      execution: harness.executionService,
      ttsClient: createImmediateTtsClient(createWavLikeBuffer("missing"))
    });
    apps.push(app);

    const statusResponse = await app.inject({
      method: "GET",
      url: "/adapters/assistant-audio-bridge/requests/unknown-request"
    });
    expect(statusResponse.statusCode).toBe(404);

    const audioResponse = await app.inject({
      method: "GET",
      url: "/adapters/assistant-audio-bridge/requests/unknown-request/audio"
    });
    expect(audioResponse.statusCode).toBe(404);
  });
});

function createTestApp(input: {
  execution: AppExecutionService;
  ttsClient: AssistantAudioBridgeTtsClient;
  spotifyClient?: AssistantAudioBridgeSpotifyClient | null;
  ttsResumePaddingMs?: number;
}) {
  const adapter = createAssistantAudioBridgeAdapter({
    enabled: true,
    threadStore: new InMemoryThreadStore(),
    agentId: "assistant_audio_bridge",
    defaultActorId: "mobile-test",
    ttsClient: input.ttsClient,
    spotifyClient: input.spotifyClient ?? null,
    spotifyDeviceCachePath: "spotify-devices-test.json",
    ttsResumePaddingMs: input.ttsResumePaddingMs ?? 1,
    audioArtifactDir: null,
    requestTtlMs: 60_000
  });

  if (adapter === null) {
    throw new Error("assistant audio bridge adapter did not initialize");
  }

  return buildApp({
    adapters: [adapter],
    execution: input.execution
  });
}

function createFakeSpotifyClient(): AssistantAudioBridgeSpotifyClient {
  return createFakeSpotifyClientHarness().client;
}

function createFakeSpotifyClientHarness(): {
  client: AssistantAudioBridgeSpotifyClient;
  getResumeCalls(): number;
} {
  let resumeCalls = 0;

  return {
    client: {
      async listDevices() {
        return [
          {
            id: "device-test",
            name: "Test Device",
            isActive: true,
            type: "Computer"
          }
        ];
      },
      async playFromQuery() {
        return {
          id: "track-test",
          name: "Test Track",
          uri: "spotify:track:test",
          artists: ["Test Artist"]
        };
      },
      async resume() {},
      async resumeWithFallback() {
        resumeCalls += 1;
      },
      async pauseAndWaitForStop() {
        return {
          paused: true,
          targetDeviceId: "device-test"
        };
      }
    } as unknown as AssistantAudioBridgeSpotifyClient,
    getResumeCalls() {
      return resumeCalls;
    }
  };
}

function createExecutionHarness(): {
  executionService: AppExecutionService;
  completeWithOutput(input: {
    requestId: string;
    finalOutput: string;
  }): Promise<void>;
} {
  const successByRequestId = new Map<string, (result: ExecutionTurnResult) => void>();
  const errorByRequestId = new Map<string, (error: unknown) => void>();

  const executionService: AppExecutionService = {
    getQueueStatus() {
      return {
        state: "idle",
        queueDepth: 0,
        processedCount: 0,
        failedCount: 0
      };
    },
    canResolveDecisions() {
      return false;
    },
    listAgents() {
      return [];
    },
    getAgentSummary() {
      return null;
    },
    hasAgent() {
      return false;
    },
    getEntrypointAgentId() {
      return null;
    },
    async submitTrigger() {
      throw new Error("submitTrigger is not used in assistant-audio-bridge tests.");
    },
    enqueueTrigger(
      triggerEvent,
      onError?: (error: unknown) => void,
      onSuccess?: (result: ExecutionTurnResult) => void
    ) {
      const triggerId = triggerEvent.trigger_id;
      const requestId = triggerId.slice(triggerId.lastIndexOf(":") + 1);

      if (onSuccess) {
        successByRequestId.set(requestId, onSuccess);
      }

      if (onError) {
        errorByRequestId.set(requestId, onError);
      }
    },
    async runTurn() {
      throw new Error("runTurn is not used in assistant-audio-bridge tests.");
    },
    async resolveDecision() {
      throw new Error("resolveDecision is not used in assistant-audio-bridge tests.");
    },
    async recoverActiveRuns() {
      return [];
    }
  };

  return {
    executionService,
    async completeWithOutput(input) {
      const success = successByRequestId.get(input.requestId);

      if (!success) {
        throw new Error(`No queued request callback for ${input.requestId}`);
      }

      try {
        await success(
          {
            thread: {
              threadId: "thread-test"
            },
            execution: {
              executionId: `execution-${input.requestId}`
            },
            finalOutput: input.finalOutput,
            replyText: input.finalOutput
          } as ExecutionTurnResult
        );
      } catch (error) {
        const failure = errorByRequestId.get(input.requestId);
        failure?.(error);
      }
    }
  };
}

function createImmediateTtsClient(
  payload: Buffer
): AssistantAudioBridgeTtsClient {
  return {
    async synthesize() {
      return payload;
    }
  } as AssistantAudioBridgeTtsClient;
}

function createDeferredTtsClient(): {
  client: AssistantAudioBridgeTtsClient;
  resolve(payload: Buffer): void;
  reject(error: Error): void;
} {
  let resolvePromise: ((payload: Buffer) => void) | null = null;
  let rejectPromise: ((error: Error) => void) | null = null;

  const client = {
    async synthesize() {
      return await new Promise<Buffer>((resolve, reject) => {
        resolvePromise = resolve;
        rejectPromise = reject;
      });
    }
  } as AssistantAudioBridgeTtsClient;

  return {
    client,
    resolve(payload) {
      resolvePromise?.(payload);
    },
    reject(error) {
      rejectPromise?.(error);
    }
  };
}

async function fetchStatus(
  app: ReturnType<typeof buildApp>,
  requestId: string
): Promise<string> {
  const statusResponse = await app.inject({
    method: "GET",
    url: `/adapters/assistant-audio-bridge/requests/${requestId}`
  });
  return statusResponse.json().status as string;
}

async function waitForStatus(
  app: ReturnType<typeof buildApp>,
  requestId: string,
  status: string
): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const current = await fetchStatus(app, requestId);

    if (current === status) {
      return;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
  }

  throw new Error(`Expected request ${requestId} status ${status}.`);
}

async function waitForCondition(
  condition: () => boolean,
  timeoutMs: number
): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (condition()) {
      return;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
  }

  throw new Error("Timed out waiting for condition.");
}

function createWavLikeBuffer(content: string): Buffer {
  return Buffer.from(`RIFF${content}WAVE`, "utf8");
}

function createStreamingWavBuffer(): Buffer {
  const data = Buffer.alloc(96, 1);
  const buffer = Buffer.alloc(44 + data.length);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(0xffffffff, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(24_000, 24);
  buffer.writeUInt32LE(48_000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(0xffffffff, 40);
  data.copy(buffer, 44);
  return buffer;
}
