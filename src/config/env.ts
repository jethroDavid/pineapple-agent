import "dotenv/config";

import { z } from "zod";

const optionalString = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}, z.string().min(1).optional());

const optionalStringArray = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();

  if (trimmed === "") {
    return undefined;
  }

  return trimmed
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}, z.array(z.string().min(1)).min(1).optional());

const optionalTelegramInboundMode = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}, z.enum(["outbound_only", "polling", "webhook"]).optional());

const optionalBoolean = z.preprocess((value) => {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim().toLowerCase();

  if (trimmed === "") {
    return undefined;
  }

  if (["true", "1", "yes", "on"].includes(trimmed)) {
    return true;
  }

  if (["false", "0", "no", "off"].includes(trimmed)) {
    return false;
  }

  return value;
}, z.boolean().optional());

const optionalLogLevel = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim().toLowerCase();
  return trimmed === "" ? undefined : trimmed;
}, z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).optional());

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: optionalLogLevel,
  TRACE_CONSOLE: optionalBoolean,
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: optionalString,
  OPENAI_API_KEY: optionalString,
  OPENAI_MODEL: optionalString,
  CODEX_MODEL: optionalString,
  PINEAPPLE_AGENTS_DIR: optionalString,
  EXECUTION_TURN_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .optional(),
  RECOVERY_ENABLED: optionalBoolean,
  CRON_ENABLED: optionalBoolean,
  CRON_JOBS_JSON: optionalString,
  ASSISTANT_BRIDGE_ENABLED: optionalBoolean,
  ASSISTANT_BRIDGE_AGENT_ID: optionalString,
  ASSISTANT_BRIDGE_DEFAULT_ACTOR_ID: optionalString,
  ASSISTANT_BRIDGE_SPOTIFY_CLIENT_ID: optionalString,
  ASSISTANT_BRIDGE_SPOTIFY_TOKEN_FILE: optionalString,
  ASSISTANT_BRIDGE_SPOTIFY_DEVICE: optionalString,
  ASSISTANT_BRIDGE_OPENAI_TTS_MODEL: optionalString,
  ASSISTANT_BRIDGE_OPENAI_TTS_VOICE: optionalString,
  ASSISTANT_BRIDGE_OPENAI_TTS_INSTRUCTIONS: optionalString,
  ASSISTANT_BRIDGE_TTS_RESUME_PADDING_MS: z.coerce
    .number()
    .int()
    .min(0)
    .optional(),
  SHORTCUT_API_TOKEN: optionalString,
  SHORTCUT_WEBHOOK_SECRET: optionalString,
  SHORTCUT_WEBHOOK_BASE_URL: optionalString,
  SHORTCUT_WEBHOOK_INTEGRATION_ID: optionalString,
  SHORTCUT_AGENT_NAME: optionalString,
  TELEGRAM_BOT_TOKEN: optionalString,
  TELEGRAM_INBOUND_MODE: optionalTelegramInboundMode,
  TELEGRAM_ALLOWED_UPDATES: optionalStringArray,
  TELEGRAM_WEBHOOK_SECRET: optionalString,
  TELEGRAM_WEBHOOK_BASE_URL: optionalString,
  TELEGRAM_POLL_INTERVAL_MS: z.coerce
    .number()
    .int()
    .positive()
    .optional(),
  TELEGRAM_POLL_TIMEOUT_SECONDS: z.coerce
    .number()
    .int()
    .min(0)
    .max(50)
    .optional(),
  TELEGRAM_WEBHOOK_MAX_CONNECTIONS: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
});

export const env = envSchema.parse(process.env);
