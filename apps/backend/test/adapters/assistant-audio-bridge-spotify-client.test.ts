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

describe("AssistantAudioBridgeSpotifyClient playlists", () => {
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

  it("lists current user playlists", async () => {
    const tokenFilePath = await createTokenFile(tempDirs, {
      accessToken: "playlist-access",
      refreshToken: "refresh",
      tokenType: "Bearer",
      expiresAt: Date.now() + 3600_000
    });

    globalThis.fetch = vi.fn(async (input, init) => {
      const url = new URL(String(input));
      expect(getAuthorizationHeader(init?.headers)).toBe("Bearer playlist-access");

      if (url.pathname === "/v1/me/playlists") {
        expect(url.searchParams.get("limit")).toBe("50");
        return jsonResponse(
          {
            total: 1,
            items: [
              {
                id: "playlist-1",
                name: "Road Trip",
                uri: "spotify:playlist:playlist-1",
                owner: {
                  display_name: "Owner"
                },
                tracks: {
                  total: 12
                },
                public: false
              }
            ]
          },
          200
        );
      }

      throw new Error(`Unexpected URL: ${url.toString()}`);
    }) as typeof fetch;

    const client = new AssistantAudioBridgeSpotifyClient({
      clientId: "client-id",
      tokenFilePath
    });

    await expect(client.listPlaylists()).resolves.toEqual([
      {
        id: "playlist-1",
        name: "Road Trip",
        uri: "spotify:playlist:playlist-1",
        ownerName: "Owner",
        trackCount: 12,
        isPublic: false
      }
    ]);
  });

  it("adds searched tracks to a named playlist", async () => {
    const tokenFilePath = await createTokenFile(tempDirs, {
      accessToken: "playlist-access",
      refreshToken: "refresh",
      tokenType: "Bearer",
      expiresAt: Date.now() + 3600_000
    });

    globalThis.fetch = vi.fn(async (input, init) => {
      const url = new URL(String(input));

      if (url.pathname === "/v1/me/playlists") {
        return playlistsResponse();
      }

      if (url.pathname === "/v1/search") {
        return jsonResponse(
          {
            tracks: {
              items: [
                {
                  id: "track-1",
                  name: "Song One",
                  uri: "spotify:track:track-1",
                  artists: [{ name: "Artist" }]
                }
              ]
            }
          },
          200
        );
      }

      if (url.pathname === "/v1/playlists/playlist-1/tracks") {
        expect(url.searchParams.get("position")).toBe("2");
        expect(getJsonBody(init?.body)).toEqual({
          uris: ["spotify:track:track-1", "spotify:track:track-2"]
        });
        return jsonResponse(
          {
            snapshot_id: "snapshot-1"
          },
          201
        );
      }

      throw new Error(`Unexpected URL: ${url.toString()}`);
    }) as typeof fetch;

    const client = new AssistantAudioBridgeSpotifyClient({
      clientId: "client-id",
      tokenFilePath
    });

    const result = await client.addTracksToPlaylist({
      playlist: "Road Trip",
      tracks: ["Song One", "spotify:track:track-2"],
      position: 2
    });

    expect(result.snapshotId).toBe("snapshot-1");
    expect(result.tracks.map((track) => track.uri)).toEqual([
      "spotify:track:track-1",
      "spotify:track:track-2"
    ]);
  });

  it("starts playlist playback at a matching playlist track", async () => {
    const tokenFilePath = await createTokenFile(tempDirs, {
      accessToken: "playlist-access",
      refreshToken: "refresh",
      tokenType: "Bearer",
      expiresAt: Date.now() + 3600_000
    });

    globalThis.fetch = vi.fn(async (input, init) => {
      const url = new URL(String(input));

      if (url.pathname === "/v1/me/playlists") {
        return playlistsResponse();
      }

      if (url.pathname === "/v1/playlists/playlist-1/tracks") {
        return jsonResponse(
          {
            total: 1,
            items: [
              {
                track: {
                  id: "track-1",
                  name: "Song One",
                  uri: "spotify:track:track-1",
                  type: "track",
                  artists: [{ name: "Artist" }]
                }
              }
            ]
          },
          200
        );
      }

      if (url.pathname === "/v1/me/player/devices") {
        return jsonResponse(
          {
            devices: [
              {
                id: "device-1",
                name: "Desk",
                is_active: true,
                type: "Computer"
              }
            ]
          },
          200
        );
      }

      if (url.pathname === "/v1/me/player/play") {
        expect(url.searchParams.get("device_id")).toBe("device-1");
        expect(getJsonBody(init?.body)).toEqual({
          context_uri: "spotify:playlist:playlist-1",
          offset: {
            uri: "spotify:track:track-1"
          }
        });
        return new Response(null, {
          status: 204
        });
      }

      throw new Error(`Unexpected URL: ${url.toString()}`);
    }) as typeof fetch;

    const client = new AssistantAudioBridgeSpotifyClient({
      clientId: "client-id",
      tokenFilePath
    });

    const result = await client.playPlaylist({
      playlist: "my Road Trip playlist",
      track: "Song One",
      deviceHint: "Desk"
    });

    expect(result.track?.uri).toBe("spotify:track:track-1");
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

function playlistsResponse(): Response {
  return jsonResponse(
    {
      total: 1,
      items: [
        {
          id: "playlist-1",
          name: "Road Trip",
          uri: "spotify:playlist:playlist-1",
          owner: {
            display_name: "Owner"
          },
          tracks: {
            total: 12
          },
          public: false
        }
      ]
    },
    200
  );
}

function getJsonBody(body: unknown): unknown {
  if (typeof body !== "string") {
    return null;
  }

  return JSON.parse(body);
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
