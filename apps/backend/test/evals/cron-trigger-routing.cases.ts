export interface ExpectedCronTriggerToolCall {
  name: string;
  arguments?: Record<string, string>;
}

export interface CronTriggerRoutingEvalCase {
  id: string;
  message: string;
  agentId?: string;
  expectedEntrypointAgentId: string;
  expectedActiveAgentId?: string;
  expectedToolCall?: ExpectedCronTriggerToolCall;
  expectedNoToolCalls?: string[];
}

export const cronTriggerRoutingCases: CronTriggerRoutingEvalCase[] = [
  {
    id: "music-tick-routes-to-audio-bridge",
    message: "Play my focus playlist on Spotify.",
    agentId: "assistant_audio_bridge",
    expectedEntrypointAgentId: "assistant_audio_bridge",
    expectedToolCall: {
      name: "assistant_bridge_spotify_play_playlist"
    },
    expectedNoToolCalls: ["cron_schedule_reminder"]
  },
  {
    id: "reminder-tick-routes-to-scheduler",
    message: "Stand up and stretch.",
    expectedEntrypointAgentId: "scheduler",
    expectedToolCall: {
      name: "telegram_send_message",
      arguments: {
        chat_id: "5001"
      }
    },
    expectedNoToolCalls: ["cron_schedule_reminder"]
  },
  {
    id: "repository-tick-routes-to-codex",
    message: "Inspect the repo and fix the failing backend Vitest suite.",
    agentId: "codex",
    expectedEntrypointAgentId: "codex",
    expectedActiveAgentId: "codex",
    expectedNoToolCalls: [
      "assistant_bridge_spotify_play_playlist",
      "telegram_send_message",
      "cron_schedule_reminder"
    ]
  }
];
