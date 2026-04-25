import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  interpolate,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming
} from "react-native-reanimated";

import {
  buildAssistantAudioUrl,
  createAssistantAudioRequest,
  fetchAssistantAudioStatus,
  notifyAssistantPlaybackComplete
} from "@/src/lib/audio-bridge-api";
import {
  type AudioPlaybackState,
  playAudioStreamWithUpdates,
  stopAudioPlayback
} from "@/src/lib/audio-player";
import { useAudioBridgeStore } from "@/src/state/audio-bridge-store";

const activeRequestStatuses = new Set([
  "queued",
  "processing",
  "ready",
  "streaming"
]);
const activePlaybackStates = new Set<AudioPlaybackState>([
  "loading",
  "playing",
  "paused"
]);
const signalBars = Array.from({ length: 18 }, (_, index) => index);

export default function AudioBridgeScreen() {
  const {
    prompt,
    requestId,
    status,
    errorMessage,
    setPrompt,
    resetRun,
    startRun,
    syncStatus,
    setError
  } = useAudioBridgeStore();
  const [isPlayerBusy, setIsPlayerBusy] = useState(false);
  const [playbackState, setPlaybackState] =
    useState<AudioPlaybackState>("idle");
  const playedRequestIdRef = useRef<string | null>(null);
  const pulse = useSharedValue(0);
  const wave = useSharedValue(0);

  const requestMutation = useMutation({
    mutationFn: async (text: string) => {
      return await createAssistantAudioRequest(text);
    },
    onSuccess(result) {
      startRun(result.request_id);
    },
    onError(error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  });

  const statusQuery = useQuery({
    queryKey: ["assistant-audio-bridge", requestId],
    enabled: requestId !== null,
    queryFn: async () => {
      if (!requestId) {
        throw new Error("Missing request id.");
      }

      return await fetchAssistantAudioStatus(requestId);
    },
    refetchInterval(query) {
      const nextStatus = query.state.data?.status;

      if (
        nextStatus === "queued" ||
        nextStatus === "processing" ||
        nextStatus === "streaming"
      ) {
        return 800;
      }

      return false;
    }
  });

  useEffect(() => {
    if (!statusQuery.data) {
      return;
    }

    syncStatus(statusQuery.data);
  }, [statusQuery.data, syncStatus]);

  useEffect(() => {
    if (!statusQuery.error) {
      return;
    }

    setError(
      statusQuery.error instanceof Error
        ? statusQuery.error.message
        : String(statusQuery.error)
    );
  }, [setError, statusQuery.error]);

  const isRequestActive = activeRequestStatuses.has(status);
  const isPlaybackActive = activePlaybackStates.has(playbackState);
  const isGenerating =
    requestMutation.isPending || status === "queued" || status === "processing";
  const isStreaming =
    playbackState === "loading" ||
    playbackState === "playing" ||
    status === "streaming";
  const canSubmit = useMemo(() => {
    return prompt.trim().length > 0 && !requestMutation.isPending;
  }, [prompt, requestMutation.isPending]);
  const canPressPower =
    isPlaybackActive || (!isRequestActive && canSubmit && !isPlayerBusy);
  const visualActive = isGenerating || isStreaming;
  const statusLabel = getStatusLabel({
    isGenerating,
    isPlayerBusy,
    playbackState,
    status
  });

  useEffect(() => {
    if (!visualActive) {
      cancelAnimation(pulse);
      cancelAnimation(wave);
      pulse.value = withTiming(0, { duration: 260 });
      wave.value = withTiming(0, { duration: 260 });
      return;
    }

    pulse.value = withRepeat(
      withTiming(1, {
        duration: isStreaming ? 900 : 1600,
        easing: Easing.inOut(Easing.ease)
      }),
      -1,
      true
    );
    wave.value = withRepeat(
      withTiming(1, {
        duration: isStreaming ? 760 : 1400,
        easing: Easing.linear
      }),
      -1,
      false
    );
  }, [isStreaming, pulse, visualActive, wave]);

  useEffect(() => {
    if (status !== "ready" || requestId === null) {
      return;
    }

    if (playedRequestIdRef.current === requestId) {
      return;
    }

    playedRequestIdRef.current = requestId;
    void playAudio(requestId);
  }, [requestId, status]);

  const outerPulseStyle = useAnimatedStyle(() => {
    return {
      opacity: interpolate(pulse.value, [0, 1], [0.2, 0.62]),
      transform: [
        {
          scale: interpolate(pulse.value, [0, 1], [0.92, 1.16])
        }
      ]
    };
  });

  const innerPulseStyle = useAnimatedStyle(() => {
    return {
      opacity: interpolate(pulse.value, [0, 1], [0.38, 0.9]),
      transform: [
        {
          scale: interpolate(pulse.value, [0, 1], [0.98, 1.05])
        }
      ]
    };
  });

  async function submitPrompt(): Promise<void> {
    const trimmed = prompt.trim();

    if (!trimmed || requestMutation.isPending) {
      return;
    }

    await stopAudioPlayback();
    setPlaybackState("idle");
    playedRequestIdRef.current = null;
    resetRun();
    requestMutation.mutate(trimmed);
  }

  async function playAudio(nextRequestId: string): Promise<void> {
    setIsPlayerBusy(true);
    try {
      const nextState = await playAudioStreamWithUpdates(
        buildAssistantAudioUrl(nextRequestId),
        setPlaybackState,
        {
          title: "Assistant stream",
          artist: "Pineapple",
          onPlaybackFinished: () => {
            void notifyAssistantPlaybackComplete(nextRequestId).catch((error) => {
              setError(error instanceof Error ? error.message : String(error));
            });
          }
        }
      );
      setPlaybackState(nextState);
    } catch (error) {
      playedRequestIdRef.current = null;
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsPlayerBusy(false);
    }
  }

  async function handlePowerPress(): Promise<void> {
    if (isPlaybackActive) {
      setIsPlayerBusy(true);
      try {
        setPlaybackState(await stopAudioPlayback());
      } catch (error) {
        setError(error instanceof Error ? error.message : String(error));
      } finally {
        setIsPlayerBusy(false);
      }
      return;
    }

    await submitPrompt();
  }

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.keyboard}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.header}>
            {/* <Text style={styles.kicker}>Pineapple</Text>
            <Text style={styles.title}>Run audio</Text> */}
          </View>

          <View style={styles.promptSurface}>
            <TextInput
              value={prompt}
              onChangeText={setPrompt}
              style={styles.input}
              multiline
              editable={!isGenerating && !isPlayerBusy}
              placeholder="Ask for a coaching burst, news brief, or story beat."
              placeholderTextColor="#6f7b88"
              autoCapitalize="sentences"
            />
          </View>

          <View style={styles.stage}>
            <Animated.View style={[styles.outerRing, outerPulseStyle]} />
            <Animated.View style={[styles.innerRing, innerPulseStyle]} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Power"
              disabled={!canPressPower}
              onPress={() => {
                void handlePowerPress();
              }}
              style={[
                styles.powerButton,
                visualActive && styles.powerButtonActive,
                !canPressPower && styles.powerButtonDisabled
              ]}
            >
              {requestMutation.isPending || isPlayerBusy ? (
                <ActivityIndicator color="#041314" size="large" />
              ) : (
                <MaterialCommunityIcons
                  name={isPlaybackActive ? "stop" : "send"}
                  color="#041314"
                  size={isPlaybackActive ? 50 : 48}
                />
              )}
            </Pressable>
          </View>

          <View style={styles.signal}>
            {signalBars.map((index) => (
              <SignalBar
                key={index}
                active={visualActive}
                index={index}
                phase={wave}
                streaming={isStreaming}
              />
            ))}
          </View>

          <View style={styles.statusRow}>
            <View
              style={[
                styles.statusDot,
                visualActive ? styles.statusDotActive : styles.statusDotIdle
              ]}
            />
            <Text style={styles.statusText}>{statusLabel}</Text>
          </View>

          {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function SignalBar(props: {
  active: boolean;
  index: number;
  phase: SharedValue<number>;
  streaming: boolean;
}) {
  const animatedStyle = useAnimatedStyle(() => {
    const offset = props.index * 0.58;
    const waveHeight = Math.abs(
      Math.sin(props.phase.value * Math.PI * 2 + offset)
    );
    const activeScale = props.streaming ? 0.38 + waveHeight * 1.12 : 0.24 + waveHeight * 0.44;

    return {
      opacity: props.active
        ? interpolate(waveHeight, [0, 1], [0.38, 1])
        : 0.2,
      transform: [
        {
          scaleY: props.active ? activeScale : 0.22
        }
      ]
    };
  });

  return <Animated.View style={[styles.signalBar, animatedStyle]} />;
}

function getStatusLabel(input: {
  isGenerating: boolean;
  isPlayerBusy: boolean;
  playbackState: AudioPlaybackState;
  status: string;
}): string {
  if (input.isPlayerBusy || input.playbackState === "loading") {
    return "Opening audio stream";
  }

  if (input.playbackState === "playing") {
    return "Streaming";
  }

  if (input.isGenerating) {
    return "Generating";
  }

  if (input.status === "error") {
    return "Needs attention";
  }

  if (input.status === "completed" || input.playbackState === "stopped") {
    return "Ready for the next prompt";
  }

  return "Ready";
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#07100f"
  },
  keyboard: {
    flex: 1
  },
  content: {
    flexGrow: 1,
    justifyContent: "space-between",
    paddingHorizontal: 22,
    paddingBottom: 28,
    paddingTop: 22
  },
  header: {
    gap: 3
  },
  kicker: {
    color: "#7fffd2",
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0,
    textTransform: "uppercase"
  },
  title: {
    color: "#f3fbf8",
    fontSize: 42,
    fontWeight: "800",
    letterSpacing: 0
  },
  promptSurface: {
    borderBottomColor: "#243632",
    borderBottomWidth: 1,
    paddingBottom: 12,
    paddingTop: 18
  },
  input: {
    minHeight: 116,
    color: "#eef7f4",
    fontSize: 21,
    fontWeight: "600",
    lineHeight: 29,
    padding: 0,
    textAlignVertical: "top"
  },
  stage: {
    alignItems: "center",
    height: 268,
    justifyContent: "center"
  },
  outerRing: {
    position: "absolute",
    width: 210,
    height: 210,
    borderRadius: 105,
    borderColor: "rgba(127, 255, 210, 0.34)",
    borderWidth: 2
  },
  innerRing: {
    position: "absolute",
    width: 162,
    height: 162,
    borderRadius: 81,
    backgroundColor: "rgba(127, 255, 210, 0.1)"
  },
  powerButton: {
    alignItems: "center",
    backgroundColor: "#7fffd2",
    borderColor: "#d4fff2",
    borderRadius: 66,
    borderWidth: 1,
    height: 132,
    justifyContent: "center",
    shadowColor: "#7fffd2",
    shadowOffset: {
      width: 0,
      height: 14
    },
    shadowOpacity: 0.25,
    shadowRadius: 26,
    width: 132
  },
  powerButtonActive: {
    backgroundColor: "#a8f4ff",
    shadowColor: "#a8f4ff"
  },
  powerButtonDisabled: {
    opacity: 0.55
  },
  signal: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    height: 54,
    justifyContent: "center"
  },
  signalBar: {
    width: 5,
    height: 42,
    borderRadius: 3,
    backgroundColor: "#8fffe0"
  },
  statusRow: {
    alignItems: "center",
    alignSelf: "center",
    flexDirection: "row",
    gap: 9,
    minHeight: 30
  },
  statusDot: {
    borderRadius: 5,
    height: 10,
    width: 10
  },
  statusDotActive: {
    backgroundColor: "#7fffd2"
  },
  statusDotIdle: {
    backgroundColor: "#65736f"
  },
  statusText: {
    color: "#c8d6d1",
    fontSize: 15,
    fontWeight: "700"
  },
  error: {
    color: "#ff9a9a",
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 20,
    marginTop: 18
  }
});
