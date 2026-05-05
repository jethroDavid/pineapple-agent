export interface ExpectedToolCall {
  name: string;
  arguments?: Record<string, string>;
}

export interface ShortcutCrossAdapterEvalCase {
  id: string;
  kind: "shortcut_trigger" | "telegram_bound_thread";
  expectedAgentId?: string;
  expectedToolCall?: ExpectedToolCall;
  expectedNoToolCalls?: string[];
}

export const shortcutCrossAdapterCases: ShortcutCrossAdapterEvalCase[] = [
  {
    id: "shortcut-story-starts-repo-work",
    kind: "shortcut_trigger",
    expectedAgentId: "codex"
  },
  {
    id: "telegram-continues-shortcut-story",
    kind: "telegram_bound_thread",
    expectedToolCall: {
      name: "shortcut_post_comment",
      arguments: {
        story_public_id: "123"
      }
    },
    expectedNoToolCalls: ["telegram_send_message"]
  }
];
