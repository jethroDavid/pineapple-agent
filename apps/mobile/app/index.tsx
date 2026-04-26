import { MaterialCommunityIcons } from "@expo/vector-icons";
import {
  ExpoSpeechRecognitionModule,
  type ExpoSpeechRecognitionErrorCode,
  useSpeechRecognitionEvent
} from "expo-speech-recognition";
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
import { theme } from "@/src/theme";

const activeRequestStatuses = new Set([
  "queued",
  "processing",
  "streaming"
]);
const activePlaybackStates = new Set<AudioPlaybackState>([
  "loading",
  "playing",
  "paused"
]);
const signalBars = Array.from({ length: 18 }, (_, index) => index);
type VoiceCaptureState = "idle" | "listening" | "finalizing" | "error";
interface TranscriptExchange {
  prompt: string;
  reply: string | null;
}

export default function AudioBridgeScreen() {
  const {
    prompt,
    requestId,
    status,
    outputText,
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
  const [voiceState, setVoiceState] = useState<VoiceCaptureState>("idle");
  const [voicePreview, setVoicePreview] = useState("");
  const [voiceHint, setVoiceHint] = useState<string | null>(null);
  const [voiceDisabledReason, setVoiceDisabledReason] = useState<string | null>(null);
  const [lastExchange, setLastExchange] = useState<TranscriptExchange | null>(null);
  const playedRequestIdRef = useRef<string | null>(null);
  const sessionScrollRef = useRef<ScrollView | null>(null);
  const micPressingRef = useRef(false);
  const pendingVoiceSubmitRef = useRef(false);
  const latestVoiceTranscriptRef = useRef("");
  const finalVoiceTranscriptRef = useRef("");
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

  useEffect(() => {
    if (!outputText) {
      return;
    }

    setLastExchange((current) => {
      if (!current) {
        return current;
      }

      if (current.reply === outputText) {
        return current;
      }

      return {
        ...current,
        reply: outputText
      };
    });
  }, [outputText]);

  useEffect(() => {
    if (voiceDisabledReason !== null) {
      return;
    }

    if (ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
      return;
    }

    setVoiceDisabledReason(
      "Voice input is unavailable on this device. Type your prompt instead."
    );
  }, [voiceDisabledReason]);

  useSpeechRecognitionEvent("start", () => {
    setVoiceState("listening");
    setVoiceHint(null);
  });

  useSpeechRecognitionEvent("result", (event) => {
    const transcript = event.results[0]?.transcript?.trim() ?? "";

    if (!transcript) {
      return;
    }

    latestVoiceTranscriptRef.current = transcript;
    setVoicePreview(transcript);

    if (event.isFinal) {
      finalVoiceTranscriptRef.current = transcript;
    }
  });

  useSpeechRecognitionEvent("error", (event) => {
    if (event.error === "aborted") {
      return;
    }

    if (
      event.error === "not-allowed" ||
      event.error === "service-not-allowed" ||
      event.error === "language-not-supported"
    ) {
      setVoiceDisabledReason(
        "Microphone or speech permission is unavailable. Type your prompt instead."
      );
    }

    setVoiceState("error");
    setVoiceHint(getVoiceErrorHint(event.error));
  });

  useSpeechRecognitionEvent("end", () => {
    void finalizeVoiceCapture();
  });

  const isAwaitingInitialPlayback =
    status === "ready" &&
    requestId !== null &&
    playedRequestIdRef.current !== requestId;
  const isRequestActive =
    activeRequestStatuses.has(status) || isAwaitingInitialPlayback;
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
  const isVoiceBusy = voiceState === "listening" || voiceState === "finalizing";
  const isVoiceDisabledByFallback = voiceDisabledReason !== null;
  const isVoiceBlockedByRun =
    requestMutation.isPending ||
    isRequestActive ||
    isPlaybackActive ||
    isPlayerBusy ||
    isGenerating;
  const canStartVoiceCapture =
    !isVoiceBusy && !isVoiceDisabledByFallback && !isVoiceBlockedByRun;
  const micControlDisabled =
    isVoiceDisabledByFallback || (isVoiceBlockedByRun && !isVoiceBusy);
  const canPressPower =
    isPlaybackActive || (!isRequestActive && canSubmit && !isPlayerBusy && !isVoiceBusy);
  const visualActive = isGenerating || isStreaming;
  const powerButtonContentColor = visualActive
    ? theme.colors.surface
    : theme.colors.onAccent;
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

  async function submitPromptText(text: string): Promise<void> {
    const trimmed = text.trim();

    if (!trimmed || requestMutation.isPending) {
      return;
    }

    await stopAudioPlayback();
    setPlaybackState("idle");
    playedRequestIdRef.current = null;
    resetRun();
    setLastExchange({
      prompt: trimmed,
      reply: null
    });
    requestMutation.mutate(trimmed);
  }

  async function submitPrompt(): Promise<void> {
    await submitPromptText(prompt);
  }

  async function beginVoiceCapture(): Promise<void> {
    if (!canStartVoiceCapture) {
      return;
    }

    micPressingRef.current = true;
    pendingVoiceSubmitRef.current = false;
    latestVoiceTranscriptRef.current = "";
    finalVoiceTranscriptRef.current = "";
    setVoicePreview("");
    setVoiceHint(null);

    if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
      setVoiceDisabledReason(
        "Voice input is unavailable on this device. Type your prompt instead."
      );
      setVoiceState("error");
      return;
    }

    try {
      const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!permission.granted) {
        setVoiceDisabledReason(
          "Microphone access is disabled. Type your prompt instead."
        );
        setVoiceHint("Microphone permission was denied.");
        setVoiceState("error");
        return;
      }

      if (!micPressingRef.current) {
        return;
      }

      setVoiceState("listening");
      ExpoSpeechRecognitionModule.start({
        lang: getRecognitionLocale(),
        interimResults: true,
        maxAlternatives: 1,
        continuous: false
      });
    } catch (error) {
      setVoiceState("error");
      setVoiceHint(error instanceof Error ? error.message : String(error));
    }
  }

  async function endVoiceCapture(): Promise<void> {
    micPressingRef.current = false;

    if (voiceState !== "listening") {
      return;
    }

    pendingVoiceSubmitRef.current = true;
    setVoiceState("finalizing");
    setVoiceHint("Transcribing...");

    try {
      ExpoSpeechRecognitionModule.stop();
    } catch (error) {
      pendingVoiceSubmitRef.current = false;
      setVoiceState("error");
      setVoiceHint(error instanceof Error ? error.message : String(error));
    }
  }

  async function finalizeVoiceCapture(): Promise<void> {
    micPressingRef.current = false;
    const pendingSubmit = pendingVoiceSubmitRef.current;
    pendingVoiceSubmitRef.current = false;
    setVoiceState("idle");

    if (!pendingSubmit) {
      return;
    }

    const transcript =
      finalVoiceTranscriptRef.current.trim() ||
      latestVoiceTranscriptRef.current.trim();

    latestVoiceTranscriptRef.current = "";
    finalVoiceTranscriptRef.current = "";
    setVoicePreview("");

    if (!transcript) {
      setVoiceHint("No speech detected. Hold to talk and try again.");
      return;
    }

    setVoiceHint(null);
    setPrompt(transcript);
    await submitPromptText(transcript);
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
            void notifyAssistantPlaybackComplete(nextRequestId)
              .then(() => statusQuery.refetch())
              .catch((error) => {
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
        <View style={styles.content}>
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
              placeholderTextColor={theme.colors.textSoft}
              autoCapitalize="sentences"
              selectionColor={theme.colors.primary}
            />
            <View style={styles.voiceDock}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Hold to talk"
                accessibilityHint="Press and hold to record your voice and release to send."
                disabled={micControlDisabled}
                onPressIn={() => {
                  void beginVoiceCapture();
                }}
                onPressOut={() => {
                  void endVoiceCapture();
                }}
                style={[
                  styles.voiceChip,
                  voiceState === "listening" && styles.voiceChipActive,
                  micControlDisabled && styles.voiceChipDisabled
                ]}
              >
                <MaterialCommunityIcons
                  name={voiceState === "listening" ? "microphone" : "microphone-outline"}
                  color={
                    voiceState === "listening"
                      ? theme.colors.onAccent
                      : theme.colors.textMuted
                  }
                  size={18}
                />
                <Text
                  style={[
                    styles.voiceChipText,
                    voiceState === "listening" && styles.voiceChipTextActive
                  ]}
                >
                  {voiceState === "listening"
                    ? "Listening"
                    : voiceState === "finalizing"
                      ? "Transcribing"
                      : "Hold to talk"}
                </Text>
              </Pressable>
              <Text style={styles.voiceHintText} numberOfLines={1}>
                {voiceDisabledReason ?? voiceHint ?? voicePreview}
              </Text>
            </View>
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
                <ActivityIndicator color={powerButtonContentColor} size="large" />
              ) : (
                <MaterialCommunityIcons
                  name={isPlaybackActive ? "stop" : "send"}
                  color={powerButtonContentColor}
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
          <View style={styles.transcriptPanel}>
            <View style={styles.transcriptHeader}>
              <Text style={styles.transcriptTitle}>Session view</Text>
              <Text style={styles.transcriptBadge}>Temporary</Text>
            </View>
            <ScrollView
              ref={sessionScrollRef}
              contentContainerStyle={styles.transcriptScrollContent}
              nestedScrollEnabled
              showsVerticalScrollIndicator={false}
              style={styles.transcriptScroll}
            >
              <View style={styles.transcriptCard}>
                <Text style={[styles.transcriptTag, styles.transcriptTagPrompt]}>
                  $ you
                </Text>
                <Text style={styles.transcriptText}>
                  {lastExchange?.prompt ?? "Your latest prompt appears here."}
                </Text>
              </View>
              <View style={styles.transcriptCard}>
                <Text style={[styles.transcriptTag, styles.transcriptTagReply]}>
                  {">"} agent
                </Text>
                <Text style={styles.transcriptText}>
                  {lastExchange?.reply ??
                    (lastExchange
                      ? "Waiting for response..."
                      : "Agent response appears here for this session only.")}
                </Text>
              </View>
            </ScrollView>
          </View>
        </View>
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
  const tone = theme.signalTones[props.index % theme.signalTones.length];
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

  return (
    <Animated.View
      style={[styles.signalBar, { backgroundColor: tone }, animatedStyle]}
    />
  );
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

function getVoiceErrorHint(code: ExpoSpeechRecognitionErrorCode): string {
  if (code === "no-speech" || code === "speech-timeout") {
    return "No speech detected. Hold to talk and try again.";
  }

  if (code === "not-allowed" || code === "service-not-allowed") {
    return "Voice permission is unavailable. Type your prompt instead.";
  }

  return "Voice capture failed. Type your prompt or try again.";
}

function getRecognitionLocale(): string {
  const locale = Intl.DateTimeFormat().resolvedOptions().locale;

  if (typeof locale === "string" && locale.trim().length > 0) {
    return locale;
  }

  return "en-US";
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.background
  },
  keyboard: {
    flex: 1
  },
  content: {
    flex: 1,
    justifyContent: "space-between",
    paddingHorizontal: 22,
    paddingBottom: 20,
    paddingTop: 22
  },
  header: {
    gap: 3
  },
  kicker: {
    color: theme.colors.primary,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0,
    textTransform: "uppercase"
  },
  title: {
    color: theme.colors.text,
    fontSize: 42,
    fontWeight: "800",
    letterSpacing: 0
  },
  promptSurface: {
    borderBottomColor: theme.colors.borderStrong,
    borderBottomWidth: 1,
    paddingBottom: 12,
    paddingTop: 18
  },
  input: {
    minHeight: 116,
    color: theme.colors.text,
    fontSize: 21,
    fontWeight: "600",
    lineHeight: 29,
    padding: 0,
    textAlignVertical: "top"
  },
  voiceDock: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    marginTop: 10
  },
  voiceChip: {
    alignItems: "center",
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.primaryBorder,
    borderRadius: 24,
    borderWidth: 1,
    flexDirection: "row",
    gap: 8,
    minHeight: 42,
    paddingHorizontal: 14
  },
  voiceChipActive: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary
  },
  voiceChipDisabled: {
    opacity: 0.4
  },
  voiceChipText: {
    color: theme.colors.textMuted,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.2,
    textTransform: "uppercase"
  },
  voiceChipTextActive: {
    color: theme.colors.onAccent
  },
  voiceHintText: {
    color: theme.colors.textSoft,
    flex: 1,
    fontSize: 12,
    fontWeight: "600"
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
    borderColor: theme.colors.accentBorder,
    borderWidth: 2
  },
  innerRing: {
    position: "absolute",
    width: 162,
    height: 162,
    borderRadius: 81,
    backgroundColor: theme.colors.secondarySoft
  },
  powerButton: {
    alignItems: "center",
    backgroundColor: theme.colors.secondary,
    borderColor: theme.colors.secondaryBorder,
    borderRadius: 66,
    borderWidth: 1,
    height: 132,
    justifyContent: "center",
    shadowColor: theme.colors.secondary,
    shadowOffset: {
      width: 0,
      height: 14
    },
    shadowOpacity: 0.25,
    shadowRadius: 26,
    width: 132
  },
  powerButtonActive: {
    backgroundColor: theme.colors.accent,
    borderColor: theme.colors.accentBorder,
    shadowColor: theme.colors.accent
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
    backgroundColor: theme.colors.primary
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
    backgroundColor: theme.colors.success
  },
  statusDotIdle: {
    backgroundColor: theme.colors.borderStrong
  },
  statusText: {
    color: theme.colors.text,
    fontSize: 15,
    fontWeight: "700"
  },
  error: {
    color: theme.colors.danger,
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 20,
    marginTop: 10
  },
  transcriptPanel: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderRadius: 14,
    borderWidth: 1,
    flexBasis: "26%",
    justifyContent: "space-between",
    marginTop: 10,
    minHeight: 170,
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  transcriptScroll: {
    flex: 1
  },
  transcriptScrollContent: {
    gap: 8,
    paddingBottom: 2
  },
  transcriptHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8
  },
  transcriptTitle: {
    color: theme.colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.4,
    textTransform: "uppercase"
  },
  transcriptBadge: {
    color: theme.colors.accent,
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase"
  },
  transcriptCard: {
    backgroundColor: theme.colors.surfaceMuted,
    borderColor: theme.colors.border,
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: "center",
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  transcriptTag: {
    fontFamily: Platform.select({
      android: "monospace",
      ios: "Menlo",
      default: "monospace"
    }),
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 4
  },
  transcriptTagPrompt: {
    color: theme.colors.primary
  },
  transcriptTagReply: {
    color: theme.colors.secondary
  },
  transcriptText: {
    color: theme.colors.text,
    fontFamily: Platform.select({
      android: "monospace",
      ios: "Menlo",
      default: "monospace"
    }),
    fontSize: 13,
    lineHeight: 18
  }
});
