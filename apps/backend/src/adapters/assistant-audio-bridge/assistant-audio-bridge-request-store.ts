export const assistantAudioBridgeRequestStatus = {
  queued: "queued",
  processing: "processing",
  ready: "ready",
  streaming: "streaming",
  completed: "completed",
  error: "error"
} as const;

export type AssistantAudioBridgeRequestStatus =
  (typeof assistantAudioBridgeRequestStatus)[keyof typeof assistantAudioBridgeRequestStatus];

interface AssistantAudioBridgeRequestRecord {
  requestId: string;
  threadId: string;
  status: AssistantAudioBridgeRequestStatus;
  text: string;
  outputText: string | null;
  executionId: string | null;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
  mimeType: string | null;
  bytes: number | null;
  audioBuffer: Buffer | null;
  errorMessage: string | null;
}

export interface AssistantAudioBridgeRequestSnapshot {
  request_id: string;
  thread_id: string;
  status: AssistantAudioBridgeRequestStatus;
  text: string;
  output_text: string | null;
  execution_id: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string;
  mime_type: string | null;
  bytes: number | null;
  error_message: string | null;
}

interface AssistantAudioBridgeAudioPayload {
  requestId: string;
  status: AssistantAudioBridgeRequestStatus;
  audioBuffer: Buffer;
  mimeType: string;
}

export class AssistantAudioBridgeRequestStore {
  readonly #records = new Map<string, AssistantAudioBridgeRequestRecord>();
  readonly #expiryTimers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly ttlMs: number) {}

  create(input: {
    requestId: string;
    threadId: string;
    text: string;
  }): AssistantAudioBridgeRequestSnapshot {
    const now = new Date();
    const record: AssistantAudioBridgeRequestRecord = {
      requestId: input.requestId,
      threadId: input.threadId,
      status: assistantAudioBridgeRequestStatus.queued,
      text: input.text,
      outputText: null,
      executionId: null,
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(now.getTime() + this.ttlMs),
      mimeType: null,
      bytes: null,
      audioBuffer: null,
      errorMessage: null
    };

    this.#records.set(record.requestId, record);
    this.refreshExpiry(record.requestId, now);
    return toSnapshot(record);
  }

  markProcessing(
    requestId: string,
    executionId: string | null
  ): AssistantAudioBridgeRequestSnapshot | null {
    return this.update(requestId, {
      status: assistantAudioBridgeRequestStatus.processing,
      executionId,
      errorMessage: null
    });
  }

  markReady(
    requestId: string,
    input: {
      executionId: string | null;
      outputText: string;
      mimeType: string;
      audioBuffer: Buffer;
    }
  ): AssistantAudioBridgeRequestSnapshot | null {
    return this.update(requestId, {
      status: assistantAudioBridgeRequestStatus.ready,
      executionId: input.executionId,
      outputText: input.outputText,
      mimeType: input.mimeType,
      bytes: input.audioBuffer.length,
      audioBuffer: input.audioBuffer,
      errorMessage: null
    });
  }

  markStreaming(requestId: string): AssistantAudioBridgeRequestSnapshot | null {
    return this.update(requestId, {
      status: assistantAudioBridgeRequestStatus.streaming
    });
  }

  markCompleted(requestId: string): AssistantAudioBridgeRequestSnapshot | null {
    return this.update(requestId, {
      status: assistantAudioBridgeRequestStatus.completed
    });
  }

  markError(
    requestId: string,
    input: {
      executionId: string | null;
      message: string;
      outputText?: string | null;
    }
  ): AssistantAudioBridgeRequestSnapshot | null {
    return this.update(requestId, {
      status: assistantAudioBridgeRequestStatus.error,
      executionId: input.executionId,
      outputText: input.outputText ?? null,
      mimeType: null,
      bytes: null,
      audioBuffer: null,
      errorMessage: input.message
    });
  }

  getSnapshot(requestId: string): AssistantAudioBridgeRequestSnapshot | null {
    const record = this.#records.get(requestId);

    if (!record) {
      return null;
    }

    return toSnapshot(record);
  }

  getAudioPayload(requestId: string): AssistantAudioBridgeAudioPayload | null {
    const record = this.#records.get(requestId);

    if (!record || !record.audioBuffer || !record.mimeType) {
      return null;
    }

    return {
      requestId: record.requestId,
      status: record.status,
      audioBuffer: record.audioBuffer,
      mimeType: record.mimeType
    };
  }

  #clearExpiryTimer(requestId: string): void {
    const existing = this.#expiryTimers.get(requestId);

    if (existing) {
      clearTimeout(existing);
      this.#expiryTimers.delete(requestId);
    }
  }

  private refreshExpiry(requestId: string, now: Date): void {
    const record = this.#records.get(requestId);

    if (!record) {
      return;
    }

    this.#clearExpiryTimer(requestId);
    const expiresAt = new Date(now.getTime() + this.ttlMs);
    record.expiresAt = expiresAt;

    const timeout = setTimeout(() => {
      this.#records.delete(requestId);
      this.#expiryTimers.delete(requestId);
    }, this.ttlMs);
    timeout.unref();
    this.#expiryTimers.set(requestId, timeout);
  }

  private update(
    requestId: string,
    patch: Partial<
      Omit<
        AssistantAudioBridgeRequestRecord,
        "requestId" | "threadId" | "createdAt" | "text"
      >
    >
  ): AssistantAudioBridgeRequestSnapshot | null {
    const record = this.#records.get(requestId);

    if (!record) {
      return null;
    }

    const now = new Date();
    const updatedRecord: AssistantAudioBridgeRequestRecord = {
      ...record,
      ...patch,
      updatedAt: now
    };
    this.#records.set(requestId, updatedRecord);
    this.refreshExpiry(requestId, now);
    return toSnapshot(updatedRecord);
  }
}

function toSnapshot(
  record: AssistantAudioBridgeRequestRecord
): AssistantAudioBridgeRequestSnapshot {
  return {
    request_id: record.requestId,
    thread_id: record.threadId,
    status: record.status,
    text: record.text,
    output_text: record.outputText,
    execution_id: record.executionId,
    created_at: record.createdAt.toISOString(),
    updated_at: record.updatedAt.toISOString(),
    expires_at: record.expiresAt.toISOString(),
    mime_type: record.mimeType,
    bytes: record.bytes,
    error_message: record.errorMessage
  };
}
