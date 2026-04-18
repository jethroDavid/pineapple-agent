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

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: optionalString,
  OPENAI_API_KEY: optionalString,
  OPENAI_MODEL: optionalString,
  CODEX_MODEL: optionalString,
  PINEAPPLE_AGENTS_DIR: optionalString,
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
