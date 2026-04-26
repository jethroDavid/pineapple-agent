import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AssistantAudioBridgeSpotifyClient } from "../../src/adapters/assistant-audio-bridge/assistant-audio-bridge-spotify-client.js";

const originalFetch = globalThis.fetch;

describe("AssistantAudioBridgeSpotifyClient reauthentication", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    await Promise.all(
      tempDirs.map(async (dir) => {
        await rm(dir, {
          recursive: true,
          force: true
        });
      })
    );
    tempDirs.length = 0;
  });

  it("triggers single-flight runtime reauth on refresh auth failure", async () => {
    const tokenFilePath = await createTokenFile(tempDirs, {
      accessToken: "expired-access",
      refreshToken: "old-refresh",
      tokenType: "Bearer",
      expiresAt: Date.now() - 1_000
    });

    let reauthCalls = 0;
    globalThis.fetch = vi.fn(async (input, init) => {
      const url = String(input);

      if (url.endsWith("/api/token")) {
        return jsonResponse(
          {
            error: "invalid_grant",
            error_description: "refresh token invalid"
          },
          400
        );
      }

      if (url.includes("/me/player/devices")) {
        expect(getAuthorizationHeader(init?.headers)).toBe("Bearer reauth-access");
        return jsonResponse(
          {
            devices: []
          },
          200
        );
      }

      throw new Error(`Unexpected URL: ${url}`);
    }) as typeof fetch;

    const client = new AssistantAudioBridgeSpotifyClient({
      clientId: "client-id",
      tokenFilePath,
      reauthorize: async () => {
        reauthCalls += 1;
        await delay(25);
        await writeSpotifyTokenFile(tokenFilePath, {
          accessToken: "reauth-access",
          refreshToken: "new-refresh",
          tokenType: "Bearer",
          expiresAt: Date.now() + 3600_000
        });
      }
    });

    await Promise.all([client.listDevices(), client.listDevices()]);
    expect(reauthCalls).toBe(1);
  });

  it("retries token refresh once after runtime reauth", async () => {
    const tokenFilePath = await createTokenFile(tempDirs, {
      accessToken: "expired-access",
      refreshToken: "old-refresh",
      tokenType: "Bearer",
      expiresAt: Date.now() - 1_000
    });

    let refreshCalls = 0;
    globalThis.fetch = vi.fn(async (input, init) => {
      const url = String(input);

      if (url.endsWith("/api/token")) {
        refreshCalls += 1;
        const refreshToken = extractRefreshTokenFromBody(init?.body);

        if (refreshToken === "old-refresh") {
          return jsonResponse(
            {
              error: "invalid_grant",
              error_description: "stale refresh token"
            },
            400
          );
        }

        if (refreshToken === "retry-refresh") {
          return jsonResponse(
            {
              access_token: "retried-access",
              token_type: "Bearer",
              expires_in: 3600
            },
            200
          );
        }
      }

      if (url.includes("/me/player/devices")) {
        expect(getAuthorizationHeader(init?.headers)).toBe("Bearer retried-access");
        return jsonResponse(
          {
            devices: []
          },
          200
        );
      }

      throw new Error(`Unexpected URL: ${url}`);
    }) as typeof fetch;

    const client = new AssistantAudioBridgeSpotifyClient({
      clientId: "client-id",
      tokenFilePath,
      reauthorize: async () => {
        await writeSpotifyTokenFile(tokenFilePath, {
          accessToken: "temporary-access",
          refreshToken: "retry-refresh",
          tokenType: "Bearer",
          expiresAt: Date.now() - 500
        });
      }
    });

    await client.listDevices();
    expect(refreshCalls).toBe(2);
  });

  it("returns explicit rerun guidance when runtime reauth fails", async () => {
    const tokenFilePath = await createTokenFile(tempDirs, {
      accessToken: "expired-access",
      refreshToken: "old-refresh",
      tokenType: "Bearer",
      expiresAt: Date.now() - 1_000
    });

    globalThis.fetch = vi.fn(async (input) => {
      const url = String(input);

      if (url.endsWith("/api/token")) {
        return jsonResponse(
          {
            error: "invalid_grant",
            error_description: "refresh token invalid"
          },
          400
        );
      }

      throw new Error(`Unexpected URL: ${url}`);
    }) as typeof fetch;

    const client = new AssistantAudioBridgeSpotifyClient({
      clientId: "client-id",
      tokenFilePath,
      reauthorize: async () => {
        throw new Error("user canceled");
      }
    });

    await expect(client.listDevices()).rejects.toThrow(/Rerun `pnpm dev:easy`/);
  });
});

function extractRefreshTokenFromBody(body: unknown): string | null {
  if (body === null || body === undefined) {
    return null;
  }

  if (body instanceof URLSearchParams) {
    return body.get("refresh_token");
  }

  if (typeof body === "string") {
    return new URLSearchParams(body).get("refresh_token");
  }

  return null;
}

function getAuthorizationHeader(headers: unknown): string | null {
  if (!headers) {
    return null;
  }

  if (headers instanceof Headers) {
    return headers.get("authorization");
  }

  if (Array.isArray(headers)) {
    const match = headers.find(([key]) => key.toLowerCase() === "authorization");
    return match?.[1] ?? null;
  }

  const record = headers as Record<string, string | undefined>;
  return record.authorization ?? record.Authorization ?? null;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}

async function createTokenFile(
  tempDirs: string[],
  tokens: {
    accessToken: string;
    refreshToken: string;
    tokenType: string;
    expiresAt: number;
  }
): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "spotify-client-test-"));
  tempDirs.push(dir);
  const tokenFilePath = join(dir, "spotify-token.json");
  await writeSpotifyTokenFile(tokenFilePath, tokens);
  return tokenFilePath;
}

async function writeSpotifyTokenFile(
  tokenFilePath: string,
  tokens: {
    accessToken: string;
    refreshToken: string;
    tokenType: string;
    expiresAt: number;
  }
): Promise<void> {
  await writeFile(tokenFilePath, `${JSON.stringify(tokens, null, 2)}\n`, "utf8");
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
