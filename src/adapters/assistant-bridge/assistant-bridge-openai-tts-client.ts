export interface AssistantBridgeOpenAiTtsConfig {
  apiKey: string;
  model: string;
  voice: string;
  instructions?: string;
  timeoutMs?: number;
}

export class AssistantBridgeOpenAiTtsClient {
  constructor(private readonly config: AssistantBridgeOpenAiTtsConfig) {}

  async synthesize(text: string): Promise<Buffer> {
    const trimmedText = text.trim();

    if (!trimmedText) {
      throw new Error("TTS text must not be empty.");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, this.config.timeoutMs ?? 30_000);
    let response: Response;

    try {
      response = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.config.apiKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model: this.config.model,
          voice: this.config.voice,
          input: trimmedText,
          response_format: "wav",
          ...(this.config.instructions
            ? { instructions: this.config.instructions }
            : {})
        }),
        signal: controller.signal
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error("OpenAI TTS request timed out.");
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `OpenAI TTS failed (${response.status}): ${errorBody.slice(0, 240)}`
      );
    }

    const audioBuffer = Buffer.from(await response.arrayBuffer());

    if (audioBuffer.length === 0) {
      throw new Error("OpenAI TTS returned empty audio.");
    }

    return audioBuffer;
  }
}
