export const assistantBridgeEventType = {
  requestReceived: "request_received",
  queued: "queued",
  processing: "processing",
  searching: "searching",
  summarizing: "summarizing",
  ttsPreparing: "tts_preparing",
  ttsChunk: "tts_chunk",
  ttsDone: "tts_done",
  completed: "completed",
  error: "error"
} as const;

export type AssistantBridgeEventType =
  (typeof assistantBridgeEventType)[keyof typeof assistantBridgeEventType];

export interface AssistantBridgeStreamEvent {
  type: AssistantBridgeEventType;
  request_id: string | null;
  thread_id: string | null;
  execution_id: string | null;
  emitted_at: string;
  payload?: Record<string, unknown>;
}
