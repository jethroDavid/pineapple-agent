import { resolve } from "node:path";

import { env } from "../../config/env.js";
import type { AdapterPlugin } from "../adapter-plugin.js";
import { createAssistantBridgeAdapter } from "./assistant-bridge-adapter.js";
import { AssistantBridgeOpenAiTtsClient } from "./assistant-bridge-openai-tts-client.js";
import { AssistantBridgeSpotifyClient } from "./assistant-bridge-spotify-client.js";

const defaultAssistantBridgeDataDir = resolve(process.cwd(), ".data/assistant-bridge");
const defaultAssistantBridgeTokenPath = resolve(
  defaultAssistantBridgeDataDir,
  "spotify-token.json"
);
const defaultAssistantBridgeDeviceCachePath = resolve(
  defaultAssistantBridgeDataDir,
  "spotify-devices.json"
);

export const assistantBridgeAdapterPlugin: AdapterPlugin = {
  id: "assistant_bridge",
  startupOrder: 140,
  create(context) {
    const enabled = env.ASSISTANT_BRIDGE_ENABLED === true;
    const spotifyClient =
      env.ASSISTANT_BRIDGE_SPOTIFY_CLIENT_ID &&
      (env.ASSISTANT_BRIDGE_SPOTIFY_TOKEN_FILE ?? defaultAssistantBridgeTokenPath)
        ? new AssistantBridgeSpotifyClient({
            clientId: env.ASSISTANT_BRIDGE_SPOTIFY_CLIENT_ID,
            tokenFilePath:
              env.ASSISTANT_BRIDGE_SPOTIFY_TOKEN_FILE ??
              defaultAssistantBridgeTokenPath,
            defaultDeviceHint: env.ASSISTANT_BRIDGE_SPOTIFY_DEVICE
          })
        : null;
    const openAiTtsClient = env.OPENAI_API_KEY
      ? new AssistantBridgeOpenAiTtsClient({
          apiKey: env.OPENAI_API_KEY,
          model:
            env.ASSISTANT_BRIDGE_OPENAI_TTS_MODEL ?? "gpt-4o-mini-tts",
          voice: env.ASSISTANT_BRIDGE_OPENAI_TTS_VOICE ?? "marin",
          instructions: env.ASSISTANT_BRIDGE_OPENAI_TTS_INSTRUCTIONS
        })
      : null;

    return createAssistantBridgeAdapter({
      enabled,
      threadStore: context.threadStore,
      agentId: env.ASSISTANT_BRIDGE_AGENT_ID ?? "assistant_bridge",
      defaultActorId: env.ASSISTANT_BRIDGE_DEFAULT_ACTOR_ID ?? "desktop-local",
      spotifyClient,
      openAiTtsClient,
      ttsResumePaddingMs: env.ASSISTANT_BRIDGE_TTS_RESUME_PADDING_MS ?? 2_000,
      spotifyDeviceCachePath: defaultAssistantBridgeDeviceCachePath
    });
  }
};
