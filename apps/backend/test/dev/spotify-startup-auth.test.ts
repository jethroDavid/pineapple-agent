import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ensureSpotifyStartupAuth,
  type AssistantAudioBridgeSpotifyTokens
} from "../../src/adapters/assistant-audio-bridge/assistant-audio-bridge-spotify-auth.js";

describe("ensureSpotifyStartupAuth", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
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

  it("runs authorization when token file is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "spotify-startup-auth-"));
    tempDirs.push(dir);
    const tokenFilePath = join(dir, "spotify-token.json");
    const issuedTokens: AssistantAudioBridgeSpotifyTokens = {
      accessToken: "startup-access-token",
      refreshToken: "startup-refresh-token",
      tokenType: "Bearer",
      expiresAt: Date.now() + 60 * 60 * 1000
    };

    const authorize = vi.fn(async () => issuedTokens);

    await ensureSpotifyStartupAuth({
      clientId: "client-id",
      tokenFilePath,
      authorize
    });

    expect(authorize).toHaveBeenCalledTimes(1);
    const saved = JSON.parse(await readFile(tokenFilePath, "utf8")) as {
      accessToken: string;
      refreshToken: string;
      tokenType: string;
    };
    expect(saved.accessToken).toBe("startup-access-token");
    expect(saved.refreshToken).toBe("startup-refresh-token");
    expect(saved.tokenType).toBe("Bearer");
  });

  it("passes redirect uri to authorization when configured", async () => {
    const dir = await mkdtemp(join(tmpdir(), "spotify-startup-auth-"));
    tempDirs.push(dir);
    const tokenFilePath = join(dir, "spotify-token.json");
    const issuedTokens: AssistantAudioBridgeSpotifyTokens = {
      accessToken: "startup-access-token",
      refreshToken: "startup-refresh-token",
      tokenType: "Bearer",
      expiresAt: Date.now() + 60 * 60 * 1000
    };

    const authorize = vi.fn(async () => issuedTokens);

    await ensureSpotifyStartupAuth({
      clientId: "client-id",
      tokenFilePath,
      redirectUri: "http://localhost:43873/spotify/callback",
      authorize
    });

    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        redirectUri: "http://localhost:43873/spotify/callback"
      })
    );
  });
});
