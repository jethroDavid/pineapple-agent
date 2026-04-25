import { create } from "zustand";

import type { AssistantAudioStatusResponse } from "@/src/lib/audio-bridge-api";

type AudioBridgeStatus = "idle" | AssistantAudioStatusResponse["status"];

interface AudioBridgeState {
  prompt: string;
  requestId: string | null;
  status: AudioBridgeStatus;
  outputText: string | null;
  errorMessage: string | null;
  setPrompt(value: string): void;
  resetRun(): void;
  startRun(requestId: string): void;
  syncStatus(payload: AssistantAudioStatusResponse): void;
  setError(message: string): void;
}

export const useAudioBridgeStore = create<AudioBridgeState>((set) => ({
  prompt: "",
  requestId: null,
  status: "idle",
  outputText: null,
  errorMessage: null,
  setPrompt(value) {
    set(() => ({
      prompt: value
    }));
  },
  resetRun() {
    set(() => ({
      requestId: null,
      status: "idle",
      outputText: null,
      errorMessage: null
    }));
  },
  startRun(requestId) {
    set(() => ({
      requestId,
      status: "queued",
      outputText: null,
      errorMessage: null
    }));
  },
  syncStatus(payload) {
    set(() => ({
      status: payload.status,
      outputText: payload.output_text,
      errorMessage: payload.error_message ?? null
    }));
  },
  setError(message) {
    set(() => ({
      status: "error",
      errorMessage: message
    }));
  }
}));
