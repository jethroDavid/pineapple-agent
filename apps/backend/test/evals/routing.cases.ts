export interface RoutingEvalCase {
  id: string;
  input: string;
  expectedAgentId: string;
  requiredTerms: string[];
}

export const routingCases: RoutingEvalCase[] = [
  {
    id: "simple-reminder",
    input: "Remind me tomorrow at 8am to pay the internet bill.",
    expectedAgentId: "scheduler",
    requiredTerms: ["tomorrow", "8am", "pay the internet bill"]
  },
  {
    id: "recurring-reminder",
    input: "Every weekday at 7:30am, remind me to check the deployment dashboard.",
    expectedAgentId: "scheduler",
    requiredTerms: ["Every weekday", "7:30am", "deployment dashboard"]
  },
  {
    id: "general-question",
    input: "Explain why PostgreSQL indexes help query speed.",
    expectedAgentId: "general_assistant",
    requiredTerms: ["PostgreSQL", "indexes", "query speed"]
  },
  {
    id: "lightweight-research",
    input: "Give me a short explanation of what OAuth scopes are.",
    expectedAgentId: "general_assistant",
    requiredTerms: ["OAuth", "scopes"]
  },
  {
    id: "coding-test-failure",
    input: "The backend Vitest suite is failing. Inspect the repo and fix it.",
    expectedAgentId: "codex",
    requiredTerms: ["backend", "Vitest", "fix"]
  },
  {
    id: "coding-config-change",
    input: "Update the Firebase config loader and add a test for missing project id.",
    expectedAgentId: "codex",
    requiredTerms: ["Firebase", "config loader", "missing project id"]
  },
  {
    id: "play-spotify-now",
    input: "Play my focus playlist on Spotify.",
    expectedAgentId: "assistant_audio_bridge",
    requiredTerms: ["focus playlist", "Spotify"]
  },
  {
    id: "choose-music-device",
    input: "Switch Spotify playback to my desk speaker.",
    expectedAgentId: "assistant_audio_bridge",
    requiredTerms: ["Spotify", "desk speaker"]
  },
  {
    id: "future-music-is-scheduler",
    input: "At 6pm, play my focus playlist on Spotify.",
    expectedAgentId: "scheduler",
    requiredTerms: ["6pm", "focus playlist", "Spotify"]
  },
  {
    id: "shortcut-coding-story",
    input:
      "Shortcut story APP-123 says add a settings page to the web app. Start working on this.",
    expectedAgentId: "codex",
    requiredTerms: ["APP-123", "settings page", "web app"]
  }
];
