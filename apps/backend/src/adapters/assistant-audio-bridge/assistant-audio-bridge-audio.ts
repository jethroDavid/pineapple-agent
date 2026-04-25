import wavefile from "wavefile";

const { WaveFile } = wavefile;

export const assistantAudioBridgeAudioMimeType = "audio/wav";

export function normalizeWavBuffer(buffer: Buffer): Buffer {
  const wav = parseWaveFile(buffer);

  if (wav === null) {
    return buffer;
  }

  return Buffer.from(wav.toBuffer());
}

export function getWavDurationMs(buffer: Buffer): number | null {
  const wav = parseWaveFile(buffer);

  if (wav === null) {
    return null;
  }

  const fmt = wav.fmt as Partial<{
    sampleRate: number;
    numChannels: number;
    bitsPerSample: number;
    byteRate: number;
  }>;
  const data = wav.data as Partial<{
    chunkSize: number;
    samples: Uint8Array;
  }>;
  const sampleRate = Number(fmt.sampleRate ?? 0);
  const channels = Number(fmt.numChannels ?? 0);
  const bitsPerSample = Number(fmt.bitsPerSample ?? 0);
  const byteRate = Number(fmt.byteRate ?? 0);

  if (sampleRate <= 0 || channels <= 0) {
    return null;
  }

  const dataSize = Number(data.samples?.length ?? data.chunkSize ?? 0);

  if (dataSize <= 0) {
    return null;
  }

  const bytesPerSecond =
    byteRate > 0
      ? byteRate
      : bitsPerSample > 0
        ? sampleRate * channels * (bitsPerSample / 8)
        : 0;

  if (bytesPerSecond <= 0) {
    return null;
  }

  const rawMs = Math.ceil((dataSize / bytesPerSecond) * 1000);
  return Math.min(120_000, Math.max(300, rawMs));
}

function parseWaveFile(buffer: Buffer): wavefile.WaveFile | null {
  try {
    return new WaveFile(buffer);
  } catch {
    return null;
  }
}
