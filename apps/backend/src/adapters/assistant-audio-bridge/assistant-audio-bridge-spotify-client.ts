import {
  type AssistantAudioBridgeSpotifyTokens,
  readSpotifyTokensFile,
  writeSpotifyTokensFile
} from "./assistant-audio-bridge-spotify-auth.js";

const spotifyAccountsBase = "https://accounts.spotify.com";
const spotifyRequestTimeoutMs = 12_000;

export interface AssistantAudioBridgeSpotifyClientConfig {
  clientId: string;
  tokenFilePath: string;
  defaultDeviceHint?: string;
  reauthorize?: () => Promise<void>;
}

export interface AssistantAudioBridgeSpotifyDevice {
  id: string;
  name: string;
  isActive: boolean;
  type: string | null;
}

export interface AssistantAudioBridgeSpotifyTrack {
  id: string;
  name: string;
  uri: string;
  artists: string[];
}

export interface AssistantAudioBridgeSpotifyPlaylist {
  id: string;
  name: string;
  uri: string;
  ownerName: string | null;
  trackCount: number | null;
  isPublic: boolean | null;
}

interface AssistantAudioBridgePlaybackState {
  is_playing?: boolean;
  device?: {
    id?: string;
  };
}

class SpotifyTokenRefreshAuthError extends Error {}

export class AssistantAudioBridgeSpotifyClient {
  #cachedTokens: AssistantAudioBridgeSpotifyTokens | null = null;
  #reauthorizationInFlight: Promise<void> | null = null;

  constructor(private readonly config: AssistantAudioBridgeSpotifyClientConfig) {}

  async pause(deviceHint?: string): Promise<void> {
    const deviceId = await this.resolveDeviceId(deviceHint);
    await this.request("PUT", "/me/player/pause", {
      query: {
        device_id: deviceId
      }
    });
  }

  async resume(deviceHint?: string): Promise<void> {
    const deviceId = await this.resolveDeviceId(deviceHint);
    await this.request("PUT", "/me/player/play", {
      query: {
        device_id: deviceId
      }
    });
  }

  async resumeWithFallback(deviceHint?: string): Promise<void> {
    const errors: string[] = [];

    try {
      await this.resume(deviceHint);
      return;
    } catch (error) {
      errors.push(this.toErrorMessage(error));
    }

    if (deviceHint !== undefined) {
      try {
        await this.request("PUT", "/me/player/play");
        return;
      } catch (error) {
        errors.push(this.toErrorMessage(error));
      }
    }

    throw new Error(`Spotify resume failed. ${errors.join(" | ")}`);
  }

  async pauseAndWaitForStop(
    deviceHint?: string,
    options: {
      timeoutMs?: number;
      pollIntervalMs?: number;
    } = {}
  ): Promise<{
    paused: boolean;
    targetDeviceId?: string;
  }> {
    const timeoutMs = options.timeoutMs ?? 3_000;
    const pollIntervalMs = options.pollIntervalMs ?? 150;
    const currentPlayback = await this.getPlaybackState({
      timeoutMs: 2_000
    }).catch(() => null);
    const targetDeviceId =
      currentPlayback?.device?.id ?? (await this.resolveDeviceId(deviceHint));

    let pauseAttemptError: unknown = null;

    try {
      await this.request("PUT", "/me/player/pause", {
        query: {
          device_id: targetDeviceId
        },
        timeoutMs: 4_000
      });
    } catch (error) {
      pauseAttemptError = error;
      try {
        await this.request("PUT", "/me/player/pause", {
          timeoutMs: 4_000
        });
        pauseAttemptError = null;
      } catch (fallbackError) {
        pauseAttemptError = fallbackError;
      }
    }

    if (pauseAttemptError !== null) {
      if (isSpotifyRestrictionViolationError(pauseAttemptError)) {
        return {
          paused: false,
          targetDeviceId
        };
      }

      throw pauseAttemptError;
    }

    let paused = await this.waitUntilPlaybackStops(timeoutMs, pollIntervalMs);

    if (!paused && targetDeviceId !== undefined) {
      await this.request("PUT", "/me/player/pause", {
        timeoutMs: 4_000
      }).catch(() => undefined);
      paused = await this.waitUntilPlaybackStops(timeoutMs, pollIntervalMs);
    }

    return {
      paused,
      targetDeviceId
    };
  }

  async playFromQuery(
    query: string,
    deviceHint?: string
  ): Promise<AssistantAudioBridgeSpotifyTrack> {
    const track = await this.findFirstTrack(query);

    if (track === null) {
      throw new Error(`No Spotify track found for query: ${query}`);
    }

    const deviceId = await this.resolveDeviceId(deviceHint);
    await this.request("PUT", "/me/player/play", {
      query: {
        device_id: deviceId
      },
      body: {
        uris: [track.uri]
      }
    });
    return track;
  }

  async listPlaylists(): Promise<AssistantAudioBridgeSpotifyPlaylist[]> {
    const playlists: AssistantAudioBridgeSpotifyPlaylist[] = [];
    let offset = 0;
    const limit = 50;

    while (true) {
      const response = await this.request("GET", "/me/playlists", {
        query: {
          limit: String(limit),
          offset: String(offset)
        },
        expectJson: true
      });
      const page = response as {
        items?: unknown[];
        total?: number;
      } | null;
      const items = page?.items ?? [];

      playlists.push(...items.flatMap((item) => this.parsePlaylist(item)));

      if (items.length < limit || playlists.length >= (page?.total ?? 0)) {
        break;
      }

      offset += items.length;
    }

    return playlists.sort((left, right) => left.name.localeCompare(right.name));
  }

  async addTracksToPlaylist(input: {
    playlist: string;
    tracks: string[];
    position?: number;
  }): Promise<{
    playlist: AssistantAudioBridgeSpotifyPlaylist;
    tracks: AssistantAudioBridgeSpotifyTrack[];
    snapshotId: string | null;
  }> {
    const playlist = await this.resolvePlaylist(input.playlist);
    const tracks = await Promise.all(
      input.tracks.map(async (track) => await this.resolveTrack(track))
    );
    const response = await this.request("POST", `/playlists/${playlist.id}/tracks`, {
      query: {
        position:
          input.position === undefined ? undefined : String(input.position)
      },
      body: {
        uris: tracks.map((track) => track.uri)
      },
      expectJson: true
    });

    return {
      playlist,
      tracks,
      snapshotId:
        typeof (response as { snapshot_id?: unknown } | null)?.snapshot_id ===
        "string"
          ? (response as { snapshot_id: string }).snapshot_id
          : null
    };
  }

  async playPlaylist(input: {
    playlist: string;
    track?: string;
    deviceHint?: string;
  }): Promise<{
    playlist: AssistantAudioBridgeSpotifyPlaylist;
    track: AssistantAudioBridgeSpotifyTrack | null;
  }> {
    const playlist = await this.resolvePlaylist(input.playlist);
    const track = input.track
      ? await this.findPlaylistTrack(playlist.id, input.track)
      : null;

    if (input.track && track === null) {
      throw new Error(
        `No matching track found in Spotify playlist "${playlist.name}" for: ${input.track}`
      );
    }

    const deviceId = await this.resolveDeviceId(input.deviceHint);
    await this.request("PUT", "/me/player/play", {
      query: {
        device_id: deviceId
      },
      body: {
        context_uri: playlist.uri,
        ...(track ? { offset: { uri: track.uri } } : {})
      }
    });

    return {
      playlist,
      track
    };
  }

  async listDevices(): Promise<AssistantAudioBridgeSpotifyDevice[]> {
    const response = await this.request("GET", "/me/player/devices", {
      expectJson: true
    });

    return ((response as { devices?: unknown[] } | null)?.devices ?? [])
      .flatMap((device) => {
        const candidate = device as {
          id?: unknown;
          name?: unknown;
          is_active?: unknown;
          type?: unknown;
        };

        if (typeof candidate.id !== "string" || typeof candidate.name !== "string") {
          return [];
        }

        return [
          {
            id: candidate.id,
            name: candidate.name,
            isActive: candidate.is_active === true,
            type: typeof candidate.type === "string" ? candidate.type : null
          }
        ];
      })
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async findFirstTrack(
    query: string
  ): Promise<AssistantAudioBridgeSpotifyTrack | null> {
    const trimmed = query.trim();

    if (!trimmed) {
      throw new Error("Spotify search query must not be empty.");
    }

    const response = await this.request("GET", "/search", {
      query: {
        q: trimmed,
        type: "track",
        limit: "1"
      },
      expectJson: true
    });
    const track = (response as {
      tracks?: {
        items?: Array<{
          id?: string;
          uri?: string;
          name?: string;
          artists?: Array<{ name?: string }>;
        }>;
      };
    } | null)?.tracks?.items?.[0] ?? null;

    if (!track?.id || !track.uri || !track.name) {
      return null;
    }

    return {
      id: track.id,
      name: track.name,
      uri: track.uri,
      artists: (track.artists ?? [])
        .map((artist) => artist.name)
        .filter((name): name is string => Boolean(name))
    };
  }

  async listPlaylistTracks(
    playlistId: string
  ): Promise<AssistantAudioBridgeSpotifyTrack[]> {
    const tracks: AssistantAudioBridgeSpotifyTrack[] = [];
    let offset = 0;
    const limit = 50;

    while (true) {
      const response = await this.request(
        "GET",
        `/playlists/${playlistId}/tracks`,
        {
          query: {
            limit: String(limit),
            offset: String(offset),
            fields:
              "items(track(id,name,uri,type,artists(name))),total"
          },
          expectJson: true
        }
      );
      const page = response as {
        items?: unknown[];
        total?: number;
      } | null;
      const items = page?.items ?? [];

      tracks.push(...items.flatMap((item) => this.parsePlaylistTrack(item)));

      if (items.length < limit || tracks.length >= (page?.total ?? 0)) {
        break;
      }

      offset += items.length;
    }

    return tracks;
  }

  async getPlaybackState(
    options: {
      timeoutMs?: number;
    } = {}
  ): Promise<AssistantAudioBridgePlaybackState | null> {
    return (await this.request("GET", "/me/player", {
      expectJson: true,
      timeoutMs: options.timeoutMs
    })) as AssistantAudioBridgePlaybackState | null;
  }

  private async getTokens(options: { forceReload?: boolean } = {}): Promise<AssistantAudioBridgeSpotifyTokens> {
    if (!options.forceReload && this.#cachedTokens) {
      return this.#cachedTokens;
    }

    const tokens = await readSpotifyTokensFile(this.config.tokenFilePath);
    this.#cachedTokens = tokens;
    return tokens;
  }

  private isExpiringSoon(tokens: AssistantAudioBridgeSpotifyTokens): boolean {
    return tokens.expiresAt <= Date.now() + 60_000;
  }

  private async ensureAccessToken(): Promise<string> {
    const tokens = await this.getTokens();

    if (!this.isExpiringSoon(tokens)) {
      return tokens.accessToken;
    }

    try {
      const refreshed = await this.refreshTokens(tokens);
      await this.persistTokens(refreshed);
      return refreshed.accessToken;
    } catch (error) {
      if (!(error instanceof SpotifyTokenRefreshAuthError)) {
        throw error;
      }

      await this.reauthorizeAfterRefreshFailure(error);
      const reloaded = await this.getTokens({
        forceReload: true
      });

      if (!this.isExpiringSoon(reloaded)) {
        return reloaded.accessToken;
      }

      const retried = await this.refreshTokens(reloaded);
      await this.persistTokens(retried);
      return retried.accessToken;
    }
  }

  private async persistTokens(tokens: AssistantAudioBridgeSpotifyTokens): Promise<void> {
    await writeSpotifyTokensFile(this.config.tokenFilePath, tokens);
    this.#cachedTokens = tokens;
  }

  private async reauthorizeAfterRefreshFailure(cause: Error): Promise<void> {
    if (!this.config.reauthorize) {
      throw cause;
    }

    if (this.#reauthorizationInFlight !== null) {
      await this.#reauthorizationInFlight;
      return;
    }

    this.#reauthorizationInFlight = (async () => {
      try {
        await this.config.reauthorize?.();
      } catch (error) {
        throw new Error(
          "Spotify reauthentication failed. Rerun `pnpm dev:easy` and complete Spotify sign-in.",
          {
            cause: error
          }
        );
      } finally {
        this.#cachedTokens = null;
      }
    })();

    try {
      await this.#reauthorizationInFlight;
    } finally {
      this.#reauthorizationInFlight = null;
    }
  }

  private async refreshTokens(
    tokens: AssistantAudioBridgeSpotifyTokens
  ): Promise<AssistantAudioBridgeSpotifyTokens> {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, spotifyRequestTimeoutMs);
    let response: Response;

    try {
      response = await fetch(`${spotifyAccountsBase}/api/token`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded"
        },
        body: new URLSearchParams({
          client_id: this.config.clientId,
          grant_type: "refresh_token",
          refresh_token: tokens.refreshToken
        }),
        signal: controller.signal
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error("Spotify token refresh timed out.");
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }

    const json = (await response.json()) as {
      access_token?: string;
      token_type?: string;
      scope?: string;
      refresh_token?: string;
      expires_in?: number;
      error_description?: string;
      error?: string;
    };

    if (!response.ok || !json.access_token || !json.token_type || !json.expires_in) {
      const message =
        json.error_description ?? json.error ?? "Spotify token refresh failed.";

      if (isSpotifyRefreshAuthFailure(response.status, json.error)) {
        throw new SpotifyTokenRefreshAuthError(message);
      }

      throw new Error(message);
    }

    return {
      accessToken: json.access_token,
      tokenType: json.token_type,
      scope: json.scope,
      refreshToken: json.refresh_token ?? tokens.refreshToken,
      expiresAt: Date.now() + json.expires_in * 1000
    };
  }

  private async resolveDeviceId(deviceHint?: string): Promise<string | undefined> {
    const hint = deviceHint ?? this.config.defaultDeviceHint;

    if (!hint) {
      return undefined;
    }

    const devices = await this.listDevices();
    const normalizedHint = hint.trim().toLowerCase();
    const exactId = devices.find((device) => device.id === hint);

    if (exactId) {
      return exactId.id;
    }

    const exactName = devices.find(
      (device) => device.name.toLowerCase() === normalizedHint
    );

    if (exactName) {
      return exactName.id;
    }

    const partialMatches = devices.filter((device) =>
      device.name.toLowerCase().includes(normalizedHint)
    );

    if (partialMatches.length === 1) {
      return partialMatches[0]!.id;
    }

    if (partialMatches.length > 1) {
      const names = partialMatches.map((device) => device.name).join(", ");
      throw new Error(`Spotify device name is ambiguous. Matches: ${names}`);
    }

    throw new Error(`No Spotify device matched: ${hint}`);
  }

  private async resolvePlaylist(
    playlistHint: string
  ): Promise<AssistantAudioBridgeSpotifyPlaylist> {
    const normalizedHint = playlistHint.trim().toLowerCase();

    if (!normalizedHint) {
      throw new Error("Spotify playlist must not be empty.");
    }

    const playlists = await this.listPlaylists();
    const exactId = playlists.find((playlist) => playlist.id === playlistHint);

    if (exactId) {
      return exactId;
    }

    const exactUri = playlists.find((playlist) => playlist.uri === playlistHint);

    if (exactUri) {
      return exactUri;
    }

    const exactName = playlists.find(
      (playlist) => playlist.name.toLowerCase() === normalizedHint
    );

    if (exactName) {
      return exactName;
    }

    const partialMatches = playlists.filter((playlist) =>
      playlist.name.toLowerCase().includes(normalizedHint)
    );

    if (partialMatches.length === 1) {
      return partialMatches[0]!;
    }

    if (partialMatches.length > 1) {
      const names = partialMatches.map((playlist) => playlist.name).join(", ");
      throw new Error(`Spotify playlist name is ambiguous. Matches: ${names}`);
    }

    throw new Error(`No Spotify playlist matched: ${playlistHint}`);
  }

  private async resolveTrack(
    trackHint: string
  ): Promise<AssistantAudioBridgeSpotifyTrack> {
    if (trackHint.startsWith("spotify:track:")) {
      return {
        id: trackHint.slice("spotify:track:".length),
        name: trackHint,
        uri: trackHint,
        artists: []
      };
    }

    const track = await this.findFirstTrack(trackHint);

    if (track === null) {
      throw new Error(`No Spotify track found for query: ${trackHint}`);
    }

    return track;
  }

  private async findPlaylistTrack(
    playlistId: string,
    trackHint: string
  ): Promise<AssistantAudioBridgeSpotifyTrack | null> {
    if (trackHint.startsWith("spotify:track:")) {
      return {
        id: trackHint.slice("spotify:track:".length),
        name: trackHint,
        uri: trackHint,
        artists: []
      };
    }

    const normalizedHint = trackHint.trim().toLowerCase();
    const tracks = await this.listPlaylistTracks(playlistId);

    return (
      tracks.find(
        (track) =>
          track.name.toLowerCase() === normalizedHint ||
          `${track.name} ${track.artists.join(" ")}`
            .toLowerCase()
            .includes(normalizedHint)
      ) ?? null
    );
  }

  private parsePlaylist(value: unknown): AssistantAudioBridgeSpotifyPlaylist[] {
    const candidate = value as {
      id?: unknown;
      name?: unknown;
      uri?: unknown;
      owner?: {
        display_name?: unknown;
        id?: unknown;
      };
      tracks?: {
        total?: unknown;
      };
      public?: unknown;
    };

    if (
      typeof candidate.id !== "string" ||
      typeof candidate.name !== "string" ||
      typeof candidate.uri !== "string"
    ) {
      return [];
    }

    return [
      {
        id: candidate.id,
        name: candidate.name,
        uri: candidate.uri,
        ownerName:
          typeof candidate.owner?.display_name === "string"
            ? candidate.owner.display_name
            : typeof candidate.owner?.id === "string"
              ? candidate.owner.id
              : null,
        trackCount:
          typeof candidate.tracks?.total === "number"
            ? candidate.tracks.total
            : null,
        isPublic:
          typeof candidate.public === "boolean" ? candidate.public : null
      }
    ];
  }

  private parsePlaylistTrack(value: unknown): AssistantAudioBridgeSpotifyTrack[] {
    const track = (value as {
      track?: {
        id?: unknown;
        name?: unknown;
        uri?: unknown;
        type?: unknown;
        artists?: Array<{ name?: unknown }>;
      } | null;
    }).track;

    if (
      track?.type !== "track" ||
      typeof track.id !== "string" ||
      typeof track.name !== "string" ||
      typeof track.uri !== "string"
    ) {
      return [];
    }

    return [
      {
        id: track.id,
        name: track.name,
        uri: track.uri,
        artists: (track.artists ?? [])
          .map((artist) => artist.name)
          .filter((name): name is string => typeof name === "string" && name !== "")
      }
    ];
  }

  private buildUrl(path: string, query?: Record<string, string | undefined>): URL {
    const url = new URL(`https://api.spotify.com/v1${path}`);

    for (const [key, value] of Object.entries(query ?? {})) {
      if (value) {
        url.searchParams.set(key, value);
      }
    }

    return url;
  }

  private async request(
    method: string,
    path: string,
    options: {
      query?: Record<string, string | undefined>;
      body?: Record<string, unknown>;
      expectJson?: boolean;
      timeoutMs?: number;
    } = {}
  ): Promise<unknown | null> {
    const accessToken = await this.ensureAccessToken();
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, options.timeoutMs ?? spotifyRequestTimeoutMs);
    let response: Response;

    try {
      response = await fetch(this.buildUrl(path, options.query), {
        method,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...(options.body ? { "content-type": "application/json" } : {})
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new Error(`Spotify API request timed out (${method} ${path}).`);
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }

    if (response.status === 204) {
      return null;
    }

    if (!response.ok) {
      const contentType = response.headers.get("content-type") ?? "";
      let message = `Spotify API request failed (${response.status})`;

      if (contentType.includes("application/json")) {
        const errorBody = (await response.json().catch(() => ({}))) as {
          error?: {
            message?: string;
          };
        };
        message = errorBody.error?.message ?? message;
      } else {
        const text = (await response.text()).trim();

        if (text) {
          message = `${message}: ${text}`;
        }
      }

      throw new Error(message);
    }

    if (options.expectJson !== true) {
      return null;
    }

    return await response.json();
  }

  private toErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return String(error);
  }

  private async waitUntilPlaybackStops(
    timeoutMs: number,
    pollIntervalMs: number
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const state = await this.getPlaybackState({
        timeoutMs: 2_000
      }).catch(() => null);

      if (state === null || state.is_playing !== true) {
        return true;
      }

      await this.delay(pollIntervalMs);
    }

    const latestState = await this.getPlaybackState({
      timeoutMs: 2_000
    }).catch(() => null);
    return latestState === null || latestState.is_playing !== true;
  }

  private async delay(ms: number): Promise<void> {
    await new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}

function isSpotifyRefreshAuthFailure(statusCode: number, errorCode: string | undefined): boolean {
  if (errorCode === "invalid_grant" || errorCode === "invalid_client") {
    return true;
  }

  return statusCode === 401;
}

function isSpotifyRestrictionViolationError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return /restriction violated/i.test(error.message);
}
