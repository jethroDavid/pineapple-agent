import {
  createAudioPlayer,
  setAudioModeAsync,
  setIsAudioActiveAsync,
  type AudioStatus
} from "expo-audio";
import { Platform } from "react-native";

export type AudioPlaybackState =
  | "idle"
  | "loading"
  | "playing"
  | "paused"
  | "stopped";

interface PlayAudioStreamOptions {
  title?: string;
  artist?: string;
  onPlaybackFinished?: () => void;
}

type AudioPlayerInstance = ReturnType<typeof createAudioPlayer>;
type AudioPlayerSubscription = ReturnType<AudioPlayerInstance["addListener"]>;

let didConfigureAudio = false;
let currentPlayer: AudioPlayerInstance | null = null;
let currentSubscription: AudioPlayerSubscription | null = null;
let playbackState: AudioPlaybackState = "idle";

function toPlaybackState(status: AudioStatus): AudioPlaybackState {
  if (!status.isLoaded || status.isBuffering) {
    return "loading";
  }

  if (status.didJustFinish) {
    return "stopped";
  }

  if (status.playing) {
    return "playing";
  }

  if (status.currentTime > 0) {
    return "paused";
  }

  return "stopped";
}

function publishPlaybackState(
  state: AudioPlaybackState,
  onPlaybackStateChange?: (state: AudioPlaybackState) => void
): AudioPlaybackState {
  playbackState = state;
  onPlaybackStateChange?.(state);
  return state;
}

function clearLockScreenControls(player: AudioPlayerInstance): void {
  try {
    player.setActiveForLockScreen(false);
    player.clearLockScreenControls();
  } catch {
    // Lock-screen APIs are native-only and best-effort during teardown.
  }
}

async function releaseCurrentPlayer(): Promise<void> {
  currentSubscription?.remove();
  currentSubscription = null;

  if (!currentPlayer) {
    return;
  }

  const player = currentPlayer;
  currentPlayer = null;

  clearLockScreenControls(player);
  player.pause();
  player.remove();
  await setIsAudioActiveAsync(false);
}

export async function ensureAudioReady(): Promise<void> {
  if (Platform.OS === "web") {
    throw new Error("Native audio playback is only available on iOS/Android.");
  }

  if (didConfigureAudio) {
    return;
  }

  await setAudioModeAsync({
    playsInSilentMode: true,
    interruptionMode: "doNotMix",
    allowsRecording: false,
    shouldPlayInBackground: true,
    shouldRouteThroughEarpiece: false
  });

  didConfigureAudio = true;
}

export async function playAudioStream(url: string): Promise<AudioPlaybackState> {
  return await playAudioStreamWithUpdates(url);
}

export async function playAudioStreamWithUpdates(
  url: string,
  onPlaybackStateChange?: (state: AudioPlaybackState) => void,
  options: PlayAudioStreamOptions = {}
): Promise<AudioPlaybackState> {
  await ensureAudioReady();
  await releaseCurrentPlayer();
  await setIsAudioActiveAsync(true);

  const player = createAudioPlayer(
    {
      uri: url,
      name: options.title ?? "Assistant stream"
    },
    {
      updateInterval: 500,
      keepAudioSessionActive: true,
      preferredForwardBufferDuration: 6
    }
  );

  currentPlayer = player;
  publishPlaybackState("loading", onPlaybackStateChange);

  currentSubscription = player.addListener("playbackStatusUpdate", (status) => {
    publishPlaybackState(toPlaybackState(status), onPlaybackStateChange);

    if (status.didJustFinish) {
      clearLockScreenControls(player);
      void setIsAudioActiveAsync(false);
      options.onPlaybackFinished?.();
    }
  });

  player.setActiveForLockScreen(
    true,
    {
      title: options.title ?? "Pineapple Assistant",
      artist: options.artist ?? "Pineapple",
      albumTitle: "Run companion"
    },
    {
      showSeekBackward: false,
      showSeekForward: false
    }
  );
  player.volume = 1;
  player.play();

  return publishPlaybackState(toPlaybackState(player.currentStatus), onPlaybackStateChange);
}

export async function toggleAudioPlayback(): Promise<AudioPlaybackState> {
  if (!currentPlayer) {
    return playbackState;
  }

  await ensureAudioReady();
  await setIsAudioActiveAsync(true);

  if (currentPlayer.playing) {
    currentPlayer.pause();
  } else {
    currentPlayer.play();
  }

  playbackState = toPlaybackState(currentPlayer.currentStatus);
  return playbackState;
}

export async function stopAudioPlayback(): Promise<AudioPlaybackState> {
  await releaseCurrentPlayer();
  playbackState = "stopped";
  return playbackState;
}
