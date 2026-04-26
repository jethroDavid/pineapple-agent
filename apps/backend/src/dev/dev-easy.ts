import { spawn } from "node:child_process";
import { resolve } from "node:path";

import {
  defaultSpotifyRedirectUri,
  ensureSpotifyStartupAuth
} from "../adapters/assistant-audio-bridge/assistant-audio-bridge-spotify-auth.js";
import { resolveDefaultSpotifyTokenPath } from "../adapters/assistant-audio-bridge/assistant-audio-bridge-paths.js";
import { loadEnvFile } from "../config/load-env.js";
import {
  syncMobileEnvForDevEasy
} from "./dev-easy-mobile-env.js";
import {
  buildDevEasyRequiredProxyTarget,
  devEasyBackendHostEnvVar,
  devEasyBackendPortEnvVar
} from "./dev-easy-config.js";
import {
  type DevEasyCommandResult,
  ensureTailscaleFunnelPreflight,
  type DevEasyCommandRunner
} from "./dev-easy-tailscale.js";

async function main(): Promise<void> {
  loadEnvFile();

  const runCommand = createCapturedCommandRunner();
  const requiredProxyTarget = buildDevEasyRequiredProxyTarget(process.env);

  console.log("[dev:easy] Checking Tailscale + Funnel...");
  console.log(
    `[dev:easy] Expected Funnel route: / -> ${requiredProxyTarget} (${devEasyBackendHostEnvVar}/${devEasyBackendPortEnvVar})`
  );
  const preflight = await ensureTailscaleFunnelPreflight({
    runCommand,
    requiredProxyTarget,
    autoEnableFunnelWhenMissing: true
  });
  if (preflight.funnelAutoEnabled) {
    console.log("[dev:easy] Funnel was missing and has been auto-enabled.");
  }
  console.log(`[dev:easy] Funnel URL detected: ${preflight.baseUrl}`);

  const mobileEnvPath = resolve(process.cwd(), "../mobile/.env");
  await syncMobileEnvForDevEasy({
    envFilePath: mobileEnvPath,
    baseUrl: preflight.baseUrl
  });
  console.log(`[dev:easy] Synced mobile env: ${mobileEnvPath}`);
  console.log(
    "[dev:easy] If Expo/Metro is already running, restart it so EXPO_PUBLIC_API_BASE_URL is reloaded."
  );

  const runtimeEnv = {
    ...process.env
  };
  injectWebhookBaseUrls(runtimeEnv, preflight.baseUrl);

  await maybeEnsureSpotifyStartupAuth(runtimeEnv);

  const pnpmCommand = "pnpm";
  await runForegroundCommand(pnpmCommand, ["--filter", "@pineapple/shared-contracts", "build"], runtimeEnv);
  await runForegroundCommand(pnpmCommand, ["exec", "tsx", "watch", "src/index.ts"], runtimeEnv);
}

function injectWebhookBaseUrls(
  env: NodeJS.ProcessEnv,
  funnelBaseUrl: string
): void {
  if (isTelegramWebhookModeEnabled(env) && !hasEnvValue(env.TELEGRAM_WEBHOOK_BASE_URL)) {
    env.TELEGRAM_WEBHOOK_BASE_URL = funnelBaseUrl;
    console.log("[dev:easy] Injected TELEGRAM_WEBHOOK_BASE_URL from Funnel URL.");
  }

  if (isShortcutWebhookModeEnabled(env) && !hasEnvValue(env.SHORTCUT_WEBHOOK_BASE_URL)) {
    env.SHORTCUT_WEBHOOK_BASE_URL = funnelBaseUrl;
    console.log("[dev:easy] Injected SHORTCUT_WEBHOOK_BASE_URL from Funnel URL.");
  }
}

function isTelegramWebhookModeEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.TELEGRAM_INBOUND_MODE?.trim().toLowerCase() === "webhook";
}

function isShortcutWebhookModeEnabled(env: NodeJS.ProcessEnv): boolean {
  return hasEnvValue(env.SHORTCUT_WEBHOOK_SECRET);
}

function hasEnvValue(value: string | undefined): boolean {
  return typeof value === "string" && value.trim() !== "";
}

async function maybeEnsureSpotifyStartupAuth(env: NodeJS.ProcessEnv): Promise<void> {
  const clientId = env.ASSISTANT_AUDIO_BRIDGE_SPOTIFY_CLIENT_ID?.trim() ?? "";

  if (clientId === "") {
    console.log("[dev:easy] Spotify auth skipped (ASSISTANT_AUDIO_BRIDGE_SPOTIFY_CLIENT_ID is unset).");
    return;
  }

  const configuredTokenFilePath = env.ASSISTANT_AUDIO_BRIDGE_SPOTIFY_TOKEN_FILE?.trim();
  const tokenFilePath = configuredTokenFilePath || resolveDefaultSpotifyTokenPath();
  const configuredRedirectUri = env.ASSISTANT_AUDIO_BRIDGE_SPOTIFY_REDIRECT_URI?.trim();
  const redirectUri = configuredRedirectUri || defaultSpotifyRedirectUri;

  console.log("[dev:easy] Validating Spotify token file...");
  console.log(`[dev:easy] Spotify redirect URI: ${redirectUri}`);
  await ensureSpotifyStartupAuth({
    clientId,
    tokenFilePath,
    redirectUri
  });
  console.log("[dev:easy] Spotify token ready.");
}

function createCapturedCommandRunner(): DevEasyCommandRunner {
  return async (command: string, args: string[]): Promise<DevEasyCommandResult> => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      shell: false
    });

    let stdout = "";
    let stderr = "";
    let errorCode: string | undefined;

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });

    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });

    return await new Promise((resolveResult) => {
      child.on("error", (error) => {
        errorCode = (error as NodeJS.ErrnoException).code;
      });

      child.on("close", (exitCode) => {
        resolveResult({
          exitCode,
          stdout,
          stderr,
          errorCode
        });
      });
    });
  };
}

async function runForegroundCommand(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env,
      stdio: "inherit",
      shell: process.platform === "win32"
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (exitCode) => {
      if (exitCode === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `Command failed: ${command} ${args.join(" ")} (exit code: ${exitCode ?? "unknown"})`
        )
      );
    });
  });
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[dev:easy] ${message}`);
  process.exit(1);
});
