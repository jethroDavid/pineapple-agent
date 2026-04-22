export const assistantBridgeAudioChunkSizeBytes = 24 * 1024;
export const assistantBridgeAudioMimeType = "audio/wav";

export function splitBufferIntoBase64Chunks(
  buffer: Buffer,
  chunkSizeBytes: number = assistantBridgeAudioChunkSizeBytes
): string[] {
  const chunks: string[] = [];

  for (let start = 0; start < buffer.length; start += chunkSizeBytes) {
    const end = Math.min(start + chunkSizeBytes, buffer.length);
    chunks.push(buffer.subarray(start, end).toString("base64"));
  }

  return chunks;
}

export function getWavDurationMs(buffer: Buffer): number | null {
  if (
    buffer.length < 12 ||
    buffer.toString("ascii", 0, 4) !== "RIFF" ||
    buffer.toString("ascii", 8, 12) !== "WAVE"
  ) {
    return null;
  }

  let offset = 12;
  let sampleRate = 0;
  let channels = 0;
  let bitsPerSample = 0;
  let dataSize = 0;
  let dataChunkStart = -1;

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkDataStart = offset + 8;

    if (chunkId === "fmt " && chunkSize >= 16 && chunkDataStart + 16 <= buffer.length) {
      channels = buffer.readUInt16LE(chunkDataStart + 2);
      sampleRate = buffer.readUInt32LE(chunkDataStart + 4);
      bitsPerSample = buffer.readUInt16LE(chunkDataStart + 14);
    } else if (chunkId === "data") {
      dataChunkStart = chunkDataStart;
      dataSize = Math.max(
        0,
        Math.min(chunkSize, buffer.length - chunkDataStart)
      );
    }

    const paddedSize = chunkSize + (chunkSize % 2);
    offset = chunkDataStart + paddedSize;
  }

  if (sampleRate <= 0 || channels <= 0 || bitsPerSample <= 0) {
    return null;
  }

  if (dataSize <= 0 && dataChunkStart >= 0) {
    dataSize = Math.max(0, buffer.length - dataChunkStart);
  }

  if (dataSize <= 0) {
    return null;
  }

  const bytesPerSample = bitsPerSample / 8;
  const bytesPerSecond = sampleRate * channels * bytesPerSample;

  if (bytesPerSecond <= 0) {
    return null;
  }

  const rawMs = Math.ceil((dataSize / bytesPerSecond) * 1000);
  return Math.min(120_000, Math.max(300, rawMs));
}

export function estimatePlaybackMsFromText(text: string): number {
  const words = text.trim().split(/\s+/).filter((word) => word.length > 0).length;

  if (words === 0) {
    return 1200;
  }

  const wordsPerMinute = 165;
  const ms = Math.ceil((words / wordsPerMinute) * 60_000);
  return Math.max(1200, ms);
}

export async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
