import { NativeModules, Platform } from "react-native";

export const assistantAudioBridgeBaseUrl = normalizeBaseUrl(
  process.env.EXPO_PUBLIC_API_BASE_URL ?? resolveDefaultApiBaseUrl()
);

export interface AssistantAudioRequestResponse {
  request_id: string;
  thread_id: string;
  status: "queued";
  status_path: string;
  audio_path: string;
}

export interface AssistantAudioStatusResponse {
  request_id: string;
  thread_id: string;
  status: "queued" | "processing" | "ready" | "streaming" | "completed" | "error";
  output_text: string | null;
  error_message: string | null;
  execution_id: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string;
  mime_type: string | null;
  bytes: number | null;
}

export interface AssistantPlaybackCompleteResponse {
  request_id: string;
  status: AssistantAudioStatusResponse["status"];
  spotify_resume_triggered: boolean;
}

export async function createAssistantAudioRequest(
  text: string
): Promise<AssistantAudioRequestResponse> {
  const response = await fetch(
    `${assistantAudioBridgeBaseUrl}/adapters/assistant-audio-bridge/requests`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        text
      })
    }
  );

  if (!response.ok) {
    throw new Error(await toApiErrorMessage(response, "Failed to create audio request."));
  }

  return (await response.json()) as AssistantAudioRequestResponse;
}

export async function fetchAssistantAudioStatus(
  requestId: string
): Promise<AssistantAudioStatusResponse> {
  const response = await fetch(
    `${assistantAudioBridgeBaseUrl}/adapters/assistant-audio-bridge/requests/${encodeURIComponent(requestId)}`
  );

  if (!response.ok) {
    throw new Error(await toApiErrorMessage(response, "Failed to fetch request status."));
  }

  return (await response.json()) as AssistantAudioStatusResponse;
}

export function buildAssistantAudioUrl(requestId: string): string {
  return `${assistantAudioBridgeBaseUrl}/adapters/assistant-audio-bridge/requests/${encodeURIComponent(requestId)}/audio`;
}

export async function notifyAssistantPlaybackComplete(
  requestId: string
): Promise<AssistantPlaybackCompleteResponse> {
  const response = await fetch(
    `${assistantAudioBridgeBaseUrl}/adapters/assistant-audio-bridge/requests/${encodeURIComponent(requestId)}/playback-complete`,
    {
      method: "POST"
    }
  );

  if (!response.ok) {
    throw new Error(
      await toApiErrorMessage(response, "Failed to notify playback completion.")
    );
  }

  return (await response.json()) as AssistantPlaybackCompleteResponse;
}

function normalizeBaseUrl(url: string): string {
  return url
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/api$/i, "");
}

function resolveDefaultApiBaseUrl(): string {
  const bundlerHost = getBundlerHost();

  if (bundlerHost) {
    if (Platform.OS === "android" && isLoopbackHost(bundlerHost)) {
      return "http://10.0.2.2:3000";
    }

    return `http://${bundlerHost}:3000`;
  }

  // Android emulators cannot reach host machine `localhost`.
  if (Platform.OS === "android") {
    return "http://10.0.2.2:3000";
  }

  return "http://localhost:3000";
}

function getBundlerHost(): string | null {
  const sourceCode = NativeModules?.SourceCode as
    | {
        scriptURL?: string;
      }
    | undefined;

  const scriptUrl = sourceCode?.scriptURL;
  if (!scriptUrl) {
    return null;
  }

  const match = scriptUrl.match(/^https?:\/\/([^/:]+)/i);
  return match?.[1] ?? null;
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

async function toApiErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const parsed = (await response.json()) as {
      error?: string;
      message?: string;
    };

    if (parsed.error && parsed.message) {
      return `${parsed.error}: ${parsed.message}`;
    }

    if (parsed.error) {
      return parsed.error;
    }

    if (parsed.message) {
      return parsed.message;
    }
  } catch {
    // fall through to fallback
  }

  return `${fallback} (${response.status})`;
}
