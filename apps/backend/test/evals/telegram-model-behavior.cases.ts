export interface ExpectedToolCall {
  name: string;
  arguments?: Record<string, string>;
}

export interface ExpectedReplyContent {
  requiredPatterns?: RegExp[];
  forbiddenPatterns?: RegExp[];
}

export interface TelegramModelBehaviorEvalCase {
  id: string;
  input: string;
  expectedAgentId?: string;
  expectedToolCall?: ExpectedToolCall;
  expectedNoToolCalls?: string[];
  failingToolName?: string;
  replyContent?: ExpectedReplyContent;
  replyStyle?: {
    maxCharacters: number;
    forbiddenPatterns: RegExp[];
  };
}

const telegramPrefix = [
  "This input came from Telegram.",
  "Telegram delivery context: chat_id=5001, chat_type=private.",
  "When replying to Telegram, call telegram_send_message with chat_id=5001.",
  "Use concise natural plain text for Telegram replies."
].join(" ");

const shortcutThreadContext = [
  "Thread context: this Telegram message is attached to Shortcut story APP-123.",
  "For requests that update, comment on, or refer to this story, use story_public_id=APP-123 with Shortcut tools.",
  "Do not claim Shortcut changes were made unless a Shortcut tool succeeds."
].join(" ");

export const telegramModelBehaviorCases: TelegramModelBehaviorEvalCase[] = [
  {
    id: "shortcut-bound-telegram-continuation",
    input: [
      telegramPrefix,
      shortcutThreadContext,
      "User message: Post an update saying I found the failing test and am fixing it."
    ].join("\n\n"),
    expectedToolCall: {
      name: "shortcut_post_comment",
      arguments: {
        story_public_id: "APP-123"
      }
    }
  },
  {
    id: "telegram-reply-style",
    input: [
      telegramPrefix,
      "User message: In one sentence, what does a database index do?"
    ].join("\n\n"),
    expectedToolCall: {
      name: "telegram_send_message",
      arguments: {
        chat_id: "5001"
      }
    },
    replyStyle: {
      maxCharacters: 240,
      forbiddenPatterns: [
        /#{1,6}\s/,
        /\*\*/,
        /```/,
        /\|.+\|/,
        /^\s*[-*]\s/m
      ]
    }
  },
  {
    id: "telegram-send-tool-choice",
    input: [
      telegramPrefix,
      "User message: Send me a quick confirmation that the build finished."
    ].join("\n\n"),
    expectedToolCall: {
      name: "telegram_send_message",
      arguments: {
        chat_id: "5001"
      }
    }
  },
  {
    id: "shortcut-tool-choice-from-telegram",
    input: [
      telegramPrefix,
      shortcutThreadContext,
      "User message: Post an update that this is fixed."
    ].join("\n\n"),
    expectedToolCall: {
      name: "shortcut_post_comment",
      arguments: {
        story_public_id: "APP-123"
      }
    }
  },
  {
    id: "delegation-from-telegram",
    input: [
      telegramPrefix,
      "User message: Inspect the repo and fix this bug. The backend test suite is failing after the adapter change."
    ].join("\n\n"),
    expectedAgentId: "codex"
  },
  {
    id: "clarifying-question",
    input: [
      telegramPrefix,
      "User message: Set that up for tomorrow."
    ].join("\n\n"),
    expectedToolCall: {
      name: "telegram_send_message",
      arguments: {
        chat_id: "5001"
      }
    },
    expectedNoToolCalls: ["cron_schedule_reminder", "shortcut_post_comment"],
    replyContent: {
      requiredPatterns: [/\?/]
    },
    replyStyle: {
      maxCharacters: 200,
      forbiddenPatterns: [
        /#{1,6}\s/,
        /\*\*/,
        /```/,
        /\|.+\|/,
        /^\s*[-*]\s/m
      ]
    }
  },
  {
    id: "no-false-tool-claim",
    input: [
      telegramPrefix,
      shortcutThreadContext,
      "User message: Post a comment saying the deployment is still blocked."
    ].join("\n\n"),
    expectedToolCall: {
      name: "shortcut_post_comment",
      arguments: {
        story_public_id: "APP-123"
      }
    },
    failingToolName: "shortcut_post_comment",
    replyContent: {
      forbiddenPatterns: [
        /\b(posted|commented|updated|added|sent|done|successfully)\b/i
      ]
    }
  },
  {
    id: "reminder-delivery-from-telegram-context",
    input: [
      "This is a scheduled reminder fired by Pineapple cron.",
      "Reminder delivery context: Telegram chat_id=5001, chat_type=private.",
      "Deliver the reminder proactively using the available Telegram channel tool.",
      "Do not ask for the chat id because it already exists in context.",
      "Reminder: Stand up and stretch."
    ].join("\n\n"),
    expectedToolCall: {
      name: "telegram_send_message",
      arguments: {
        chat_id: "5001"
      }
    },
    expectedNoToolCalls: ["cron_schedule_reminder"]
  },
  {
    id: "unsupported-telegram-content-grace",
    input: [
      telegramPrefix,
      "User message: [Telegram photo message with no caption. The image bytes are unavailable to Pineapple.]"
    ].join("\n\n"),
    expectedToolCall: {
      name: "telegram_send_message",
      arguments: {
        chat_id: "5001"
      }
    },
    replyContent: {
      requiredPatterns: [/\b(image|photo|caption|describe|text|context)\b/i],
      forbiddenPatterns: [/\bI can see\b/i, /\bthe screenshot shows\b/i]
    },
    replyStyle: {
      maxCharacters: 240,
      forbiddenPatterns: [
        /#{1,6}\s/,
        /\*\*/,
        /```/,
        /\|.+\|/,
        /^\s*[-*]\s/m
      ]
    }
  }
];
