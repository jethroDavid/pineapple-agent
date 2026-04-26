import { randomBytes, createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { createServer } from "node:http";
import { dirname } from "node:path";
import { spawn } from "node:child_process";

import { defaultSpotifyRedirectUri as defaultSpotifyRedirectUriFromNetwork } from "../../config/network-defaults.js";

const spotifyAccountsBase = "https://accounts.spotify.com";
const spotifyAuthTimeoutMs = 300_000;
const spotifyRequestTimeoutMs = 12_000;
const spotifyScopes = [
  "user-read-playback-state",
  "user-modify-playback-state",
  "user-read-currently-playing"
];
export const defaultSpotifyRedirectUri = defaultSpotifyRedirectUriFromNetwork;

export interface AssistantAudioBridgeSpotifyTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  tokenType: string;
  scope?: string;
}

export interface SpotifyAuthorizationOptions {
  clientId: string;
  tokenFilePath: string;
  redirectUri?: string;
}

export type SpotifyAuthorizationFn = (
  options: SpotifyAuthorizationOptions
) => Promise<AssistantAudioBridgeSpotifyTokens>;

export async function ensureSpotifyStartupAuth(
  options: SpotifyAuthorizationOptions & {
    authorize?: SpotifyAuthorizationFn;
  }
): Promise<void> {
  try {
    await readSpotifyTokensFile(options.tokenFilePath);
    return;
  } catch {
    await reauthorizeSpotifyTokens(options);
  }
}

export async function reauthorizeSpotifyTokens(
  options: SpotifyAuthorizationOptions & {
    authorize?: SpotifyAuthorizationFn;
  }
): Promise<AssistantAudioBridgeSpotifyTokens> {
  const authorize = options.authorize ?? runSpotifyAuthorizationCodePkceFlow;
  const tokens = await authorize({
    clientId: options.clientId,
    tokenFilePath: options.tokenFilePath,
    redirectUri: options.redirectUri
  });
  await writeSpotifyTokensFile(options.tokenFilePath, tokens);
  return tokens;
}

export async function readSpotifyTokensFile(
  tokenFilePath: string
): Promise<AssistantAudioBridgeSpotifyTokens> {
  const raw = await fs.readFile(tokenFilePath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  const tokens = parseSpotifyTokens(parsed);

  if (tokens === null) {
    throw new Error("Spotify token file is missing required fields.");
  }

  return tokens;
}

export async function writeSpotifyTokensFile(
  tokenFilePath: string,
  tokens: AssistantAudioBridgeSpotifyTokens
): Promise<void> {
  await fs.mkdir(dirname(tokenFilePath), {
    recursive: true
  });
  await fs.writeFile(tokenFilePath, `${JSON.stringify(tokens, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
}

export function parseSpotifyTokens(
  value: unknown
): AssistantAudioBridgeSpotifyTokens | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    typeof value.accessToken !== "string" ||
    typeof value.refreshToken !== "string" ||
    typeof value.tokenType !== "string" ||
    typeof value.expiresAt !== "number"
  ) {
    return null;
  }

  if (
    value.accessToken.trim() === "" ||
    value.refreshToken.trim() === "" ||
    value.tokenType.trim() === ""
  ) {
    return null;
  }

  return {
    accessToken: value.accessToken,
    refreshToken: value.refreshToken,
    tokenType: value.tokenType,
    expiresAt: value.expiresAt,
    scope: typeof value.scope === "string" ? value.scope : undefined
  };
}

export async function runSpotifyAuthorizationCodePkceFlow(
  options: SpotifyAuthorizationOptions
): Promise<AssistantAudioBridgeSpotifyTokens> {
  const redirectUri = resolveSpotifyRedirectUri(options.redirectUri);
  const codeVerifier = createCodeVerifier();
  const codeChallenge = createCodeChallenge(codeVerifier);
  const state = randomBytes(16).toString("hex");
  const authUrl = buildSpotifyAuthorizationUrl({
    clientId: options.clientId,
    codeChallenge,
    redirectUri,
    state
  });

  const authorizationCode = await waitForSpotifyAuthorizationCode({
    authUrl,
    redirectUri,
    expectedState: state
  });

  return await exchangeSpotifyAuthorizationCode({
    authorizationCode,
    clientId: options.clientId,
    codeVerifier,
    redirectUri
  });
}

function buildSpotifyAuthorizationUrl(options: {
  clientId: string;
  codeChallenge: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL(`${spotifyAccountsBase}/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", options.clientId);
  url.searchParams.set("scope", spotifyScopes.join(" "));
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("code_challenge", options.codeChallenge);
  url.searchParams.set("redirect_uri", options.redirectUri);
  url.searchParams.set("state", options.state);
  return url.toString();
}

function createCodeVerifier(): string {
  return toBase64Url(randomBytes(64));
}

function createCodeChallenge(codeVerifier: string): string {
  return toBase64Url(createHash("sha256").update(codeVerifier).digest());
}

async function waitForSpotifyAuthorizationCode(options: {
  authUrl: string;
  redirectUri: string;
  expectedState: string;
}): Promise<string> {
  const callbackResult = captureSpotifyCallbackCode(options);
  await openExternalUrl(options.authUrl);
  return await callbackResult;
}

async function captureSpotifyCallbackCode(options: {
  redirectUri: string;
  expectedState: string;
}): Promise<string> {
  const redirect = parseSpotifyRedirectUri(options.redirectUri);
  const callbackPort = Number.parseInt(redirect.port, 10);
  const callbackHost = redirect.hostname;
  const server = createServer();
  let finished = false;

  const codePromise = new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      finalize(() => {
        reject(
          new Error(
            "Spotify login timed out. Rerun `pnpm dev:easy` and complete the browser prompt."
          )
        );
      });
    }, spotifyAuthTimeoutMs);

    const finalize = (action: () => void) => {
      if (finished) {
        return;
      }

      finished = true;
      clearTimeout(timeout);
      server.close();
      action();
    };

    server.on("request", (request, response) => {
      try {
        const requestUrl = new URL(request.url ?? "", options.redirectUri);

        if (requestUrl.pathname !== redirect.pathname) {
          response.statusCode = 404;
          response.end("Not found");
          return;
        }

        const returnedState = requestUrl.searchParams.get("state");
        const error = requestUrl.searchParams.get("error");
        const code = requestUrl.searchParams.get("code");

        if (returnedState !== options.expectedState) {
          response.statusCode = 400;
          response.end("Spotify auth failed: invalid state.");
          finalize(() => {
            reject(new Error("Spotify auth failed due to an invalid callback state."));
          });
          return;
        }

        if (error) {
          response.statusCode = 400;
          response.end("Spotify auth canceled. You can close this window.");
          finalize(() => {
            reject(new Error(`Spotify authorization failed: ${error}`));
          });
          return;
        }

        if (!code) {
          response.statusCode = 400;
          response.end("Spotify auth failed: missing code.");
          finalize(() => {
            reject(new Error("Spotify authorization callback did not include a code."));
          });
          return;
        }

        response.statusCode = 200;
        response.end("Spotify authentication complete. You can close this window.");
        finalize(() => {
          resolve(code);
        });
      } catch (error) {
        finalize(() => {
          reject(error);
        });
      }
    });

    server.on("error", (error) => {
      finalize(() => {
        reject(
          new Error(
            `Spotify callback server failed on ${redirect.host}. Ensure nothing else is using port ${callbackPort}.`,
            {
              cause: error
            }
          )
        );
      });
    });

    server.listen(callbackPort, callbackHost);
  });

  return await codePromise;
}

async function exchangeSpotifyAuthorizationCode(options: {
  authorizationCode: string;
  clientId: string;
  codeVerifier: string;
  redirectUri: string;
}): Promise<AssistantAudioBridgeSpotifyTokens> {
  const response = await fetchWithTimeout(`${spotifyAccountsBase}/api/token`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: options.authorizationCode,
      client_id: options.clientId,
      redirect_uri: options.redirectUri,
      code_verifier: options.codeVerifier
    })
  });

  const json = (await response.json()) as {
    access_token?: string;
    token_type?: string;
    scope?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  if (
    !response.ok ||
    !json.access_token ||
    !json.refresh_token ||
    !json.token_type ||
    !json.expires_in
  ) {
    const message =
      json.error_description ?? json.error ?? "Spotify authorization failed.";
    throw new Error(message);
  }

  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    tokenType: json.token_type,
    scope: json.scope,
    expiresAt: Date.now() + json.expires_in * 1000
  };
}

async function openExternalUrl(url: string): Promise<void> {
  if (process.platform === "win32") {
    spawn("rundll32", ["url.dll,FileProtocolHandler", url], {
      detached: true,
      stdio: "ignore"
    }).unref();
    return;
  }

  if (process.platform === "darwin") {
    spawn("open", [url], {
      detached: true,
      stdio: "ignore"
    }).unref();
    return;
  }

  spawn("xdg-open", [url], {
    detached: true,
    stdio: "ignore"
  }).unref();
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, spotifyRequestTimeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Spotify request timed out.");
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function toBase64Url(input: Buffer): string {
  return input
    .toString("base64")
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/u, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function resolveSpotifyRedirectUri(override?: string): string {
  if (!override || override.trim() === "") {
    return defaultSpotifyRedirectUri;
  }

  return parseSpotifyRedirectUri(override).toString();
}

function parseSpotifyRedirectUri(redirectUri: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(redirectUri);
  } catch {
    throw new Error("ASSISTANT_AUDIO_BRIDGE_SPOTIFY_REDIRECT_URI must be a valid URL.");
  }

  if (parsed.protocol !== "http:") {
    throw new Error("ASSISTANT_AUDIO_BRIDGE_SPOTIFY_REDIRECT_URI must use http://.");
  }

  if (!parsed.hostname) {
    throw new Error(
      "ASSISTANT_AUDIO_BRIDGE_SPOTIFY_REDIRECT_URI must include a hostname."
    );
  }

  if (!parsed.port) {
    throw new Error("ASSISTANT_AUDIO_BRIDGE_SPOTIFY_REDIRECT_URI must include an explicit port.");
  }

  const port = Number.parseInt(parsed.port, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(
      "ASSISTANT_AUDIO_BRIDGE_SPOTIFY_REDIRECT_URI port must be between 1 and 65535."
    );
  }

  return parsed;
}
