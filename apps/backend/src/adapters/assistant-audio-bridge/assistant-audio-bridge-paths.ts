import { resolve } from "node:path";

export function resolveAssistantAudioBridgeDataDir(cwd: string = process.cwd()): string {
  return resolve(cwd, ".data/assistant-audio-bridge");
}

export function resolveDefaultSpotifyTokenPath(cwd: string = process.cwd()): string {
  return resolve(resolveAssistantAudioBridgeDataDir(cwd), "spotify-token.json");
}

export function resolveDefaultSpotifyDeviceCachePath(cwd: string = process.cwd()): string {
  return resolve(resolveAssistantAudioBridgeDataDir(cwd), "spotify-devices.json");
}

export function resolveDefaultAudioArtifactDir(cwd: string = process.cwd()): string {
  return resolve(resolveAssistantAudioBridgeDataDir(cwd), "audio");
}
