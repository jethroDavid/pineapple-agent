import { env } from "../../config/env.js";
import { OpenAiTtsClient } from "../../shared/openai/openai-tts-client.js";
import { resolveAdapterEnabled } from "../adapter-enabled.js";
import type { AdapterPlugin } from "../adapter-plugin.js";
import { createAssistantAudioBridgeAdapter } from "./assistant-audio-bridge-adapter.js";
import {
  reauthorizeSpotifyTokens
} from "./assistant-audio-bridge-spotify-auth.js";
import {
  resolveDefaultAudioArtifactDir,
  resolveDefaultSpotifyDeviceCachePath,
  resolveDefaultSpotifyTokenPath
} from "./assistant-audio-bridge-paths.js";
import { AssistantAudioBridgeSpotifyClient } from "./assistant-audio-bridge-spotify-client.js";

const defaultSpotifyTokenPath = resolveDefaultSpotifyTokenPath();
const defaultSpotifyDeviceCachePath = resolveDefaultSpotifyDeviceCachePath();
const defaultAudioArtifactDir = resolveDefaultAudioArtifactDir();

export const assistantAudioBridgeAdapterPlugin: AdapterPlugin = {
  id: "assistant_audio_bridge",
  startupOrder: 145,
  create(context) {
    const enabled = resolveAdapterEnabled({
      explicit: env.ASSISTANT_AUDIO_BRIDGE_ENABLED,
      hasConfig: hasAssistantAudioBridgeConfig()
    });

    if (!enabled) {
      return createAssistantAudioBridgeAdapter({
        enabled: false,
        threadStore: context.threadStore,
        agentId: env.ASSISTANT_AUDIO_BRIDGE_AGENT_ID ?? "assistant_audio_bridge",
        defaultActorId:
          env.ASSISTANT_AUDIO_BRIDGE_DEFAULT_ACTOR_ID ?? "mobile-local",
        ttsClient: null,
        spotifyClient: null,
        spotifyDeviceCachePath:
          env.ASSISTANT_AUDIO_BRIDGE_SPOTIFY_DEVICE_CACHE_FILE ??
          defaultSpotifyDeviceCachePath,
        ttsResumePaddingMs:
          env.ASSISTANT_AUDIO_BRIDGE_TTS_RESUME_PADDING_MS ?? 2_000,
        audioArtifactDir:
          env.ASSISTANT_AUDIO_BRIDGE_AUDIO_ARTIFACT_DIR ?? defaultAudioArtifactDir,
        requestTtlMs: env.ASSISTANT_AUDIO_BRIDGE_RESULT_TTL_MS ?? 600_000
      });
    }

    return createAssistantAudioBridgeAdapter({
      enabled,
      threadStore: context.threadStore,
      agentId: env.ASSISTANT_AUDIO_BRIDGE_AGENT_ID ?? "assistant_audio_bridge",
      defaultActorId:
        env.ASSISTANT_AUDIO_BRIDGE_DEFAULT_ACTOR_ID ?? "mobile-local",
      ttsClient: createTtsClient(),
      spotifyClient: createSpotifyClient(),
      spotifyDeviceCachePath:
        env.ASSISTANT_AUDIO_BRIDGE_SPOTIFY_DEVICE_CACHE_FILE ??
        defaultSpotifyDeviceCachePath,
      ttsResumePaddingMs:
        env.ASSISTANT_AUDIO_BRIDGE_TTS_RESUME_PADDING_MS ?? 2_000,
      audioArtifactDir:
        env.ASSISTANT_AUDIO_BRIDGE_AUDIO_ARTIFACT_DIR ?? defaultAudioArtifactDir,
      requestTtlMs: env.ASSISTANT_AUDIO_BRIDGE_RESULT_TTL_MS ?? 600_000
    });
  }
};

function hasAssistantAudioBridgeConfig(): boolean {
  return (
    env.ASSISTANT_AUDIO_BRIDGE_AGENT_ID !== undefined ||
    env.ASSISTANT_AUDIO_BRIDGE_DEFAULT_ACTOR_ID !== undefined ||
    env.ASSISTANT_AUDIO_BRIDGE_OPENAI_TTS_MODEL !== undefined ||
    env.ASSISTANT_AUDIO_BRIDGE_OPENAI_TTS_VOICE !== undefined ||
    env.ASSISTANT_AUDIO_BRIDGE_OPENAI_TTS_INSTRUCTIONS !== undefined ||
    env.ASSISTANT_AUDIO_BRIDGE_SPOTIFY_CLIENT_ID !== undefined ||
    env.ASSISTANT_AUDIO_BRIDGE_SPOTIFY_TOKEN_FILE !== undefined ||
    env.ASSISTANT_AUDIO_BRIDGE_SPOTIFY_REDIRECT_URI !== undefined ||
    env.ASSISTANT_AUDIO_BRIDGE_SPOTIFY_DEVICE !== undefined ||
    env.ASSISTANT_AUDIO_BRIDGE_SPOTIFY_DEVICE_CACHE_FILE !== undefined ||
    env.ASSISTANT_AUDIO_BRIDGE_AUDIO_ARTIFACT_DIR !== undefined ||
    env.ASSISTANT_AUDIO_BRIDGE_TTS_RESUME_PADDING_MS !== undefined ||
    env.ASSISTANT_AUDIO_BRIDGE_RESULT_TTL_MS !== undefined
  );
}

function createSpotifyClient(): AssistantAudioBridgeSpotifyClient | null {
  const spotifyClientId = env.ASSISTANT_AUDIO_BRIDGE_SPOTIFY_CLIENT_ID;

  if (!spotifyClientId) {
    return null;
  }

  return new AssistantAudioBridgeSpotifyClient({
    clientId: spotifyClientId,
    tokenFilePath: env.ASSISTANT_AUDIO_BRIDGE_SPOTIFY_TOKEN_FILE ?? defaultSpotifyTokenPath,
    defaultDeviceHint: env.ASSISTANT_AUDIO_BRIDGE_SPOTIFY_DEVICE,
    reauthorize: async () => {
      await reauthorizeSpotifyTokens({
        clientId: spotifyClientId,
        tokenFilePath: env.ASSISTANT_AUDIO_BRIDGE_SPOTIFY_TOKEN_FILE ?? defaultSpotifyTokenPath,
        redirectUri: env.ASSISTANT_AUDIO_BRIDGE_SPOTIFY_REDIRECT_URI
      });
    }
  });
}

function createTtsClient(): OpenAiTtsClient | null {
  if (!env.OPENAI_API_KEY) {
    return null;
  }

  return new OpenAiTtsClient({
    apiKey: env.OPENAI_API_KEY,
    model: env.ASSISTANT_AUDIO_BRIDGE_OPENAI_TTS_MODEL ?? "gpt-4o-mini-tts",
    voice: env.ASSISTANT_AUDIO_BRIDGE_OPENAI_TTS_VOICE ?? "marin",
    instructions: env.ASSISTANT_AUDIO_BRIDGE_OPENAI_TTS_INSTRUCTIONS
  });
}
