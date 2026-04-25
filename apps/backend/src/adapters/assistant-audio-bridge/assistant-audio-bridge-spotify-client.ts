import { promises as fs } from "node:fs";

const spotifyAccountsBase = "https://accounts.spotify.com";
const spotifyRequestTimeoutMs = 12_000;

export interface AssistantAudioBridgeSpotifyClientConfig {
  clientId: string;
  tokenFilePath: string;
  defaultDeviceHint?: string;
}

export interface AssistantAudioBridgeSpotifyDevice {
  id: string;
  name: string;
  isActive: boolean;
  type: string | null;
}

interface AssistantAudioBridgeSpotifyTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  tokenType: string;
  scope?: string;
}

interface AssistantAudioBridgeSpotifyTrack {
  id: string;
  name: string;
  uri: string;
  artists: string[];
}

interface AssistantAudioBridgePlaybackState {
  is_playing?: boolean;
  device?: {
    id?: string;
  };
}

export class AssistantAudioBridgeSpotifyClient {
  #cachedTokens: AssistantAudioBridgeSpotifyTokens | null = null;

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

    await this.request("PUT", "/me/player/pause", {
      query: {
        device_id: targetDeviceId
      },
      timeoutMs: 4_000
    }).catch(async () => {
      await this.request("PUT", "/me/player/pause", {
        timeoutMs: 4_000
      });
    });

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

  private async getTokens(): Promise<AssistantAudioBridgeSpotifyTokens> {
    if (this.#cachedTokens) {
      return this.#cachedTokens;
    }

    const raw = await fs.readFile(this.config.tokenFilePath, "utf8");
    const tokens = JSON.parse(raw) as Partial<AssistantAudioBridgeSpotifyTokens>;

    if (
      !tokens.accessToken ||
      !tokens.refreshToken ||
      !tokens.expiresAt ||
      !tokens.tokenType
    ) {
      throw new Error("Spotify token file is missing required fields.");
    }

    this.#cachedTokens = {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      tokenType: tokens.tokenType,
      scope: tokens.scope
    };
    return this.#cachedTokens;
  }

  private isExpiringSoon(tokens: AssistantAudioBridgeSpotifyTokens): boolean {
    return tokens.expiresAt <= Date.now() + 60_000;
  }

  private async ensureAccessToken(): Promise<string> {
    const tokens = await this.getTokens();

    if (!this.isExpiringSoon(tokens)) {
      return tokens.accessToken;
    }

    const refreshed = await this.refreshTokens(tokens);
    await fs.writeFile(
      this.config.tokenFilePath,
      `${JSON.stringify(refreshed, null, 2)}\n`,
      {
        encoding: "utf8",
        mode: 0o600
      }
    );
    this.#cachedTokens = refreshed;
    return refreshed.accessToken;
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
