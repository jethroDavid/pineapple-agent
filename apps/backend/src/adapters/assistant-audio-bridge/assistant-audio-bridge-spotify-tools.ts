import { promises as fs } from "node:fs";
import { dirname } from "node:path";

import { z } from "zod";

import type { ToolDefinition } from "../../tools/tool-definition.js";
import { cronReminderScheduledTurnMarker } from "../cron/cron-schedule-reminder-tool.js";
import {
  AssistantAudioBridgeSpotifyClient,
  type AssistantAudioBridgeSpotifyDevice,
  type AssistantAudioBridgeSpotifyPlaylist,
  type AssistantAudioBridgeSpotifyTrack
} from "./assistant-audio-bridge-spotify-client.js";

const spotifyPlayInputSchema = z.object({
  query: z.string().min(1).nullable(),
  device: z.string().min(1).nullable()
});

const spotifyPlayOutputSchema = z.object({
  ok: z.literal(true),
  mode: z.enum(["resume", "search_play"]),
  track_name: z.string().nullable(),
  track_uri: z.string().nullable(),
  artists: z.array(z.string().min(1)).nullable()
});

const spotifyPauseInputSchema = z.object({
  device: z.string().min(1).nullable()
});

const spotifyPauseOutputSchema = z.object({
  ok: z.literal(true)
});

const spotifyResumeInputSchema = z.object({
  device: z.string().min(1).nullable()
});

const spotifyResumeOutputSchema = z.object({
  ok: z.literal(true)
});

const spotifyDeviceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  is_active: z.boolean(),
  type: z.string().min(1).nullable()
});

const spotifyListDevicesInputSchema = z.object({
  refresh: z.boolean()
});

const spotifyListDevicesOutputSchema = z.object({
  ok: z.literal(true),
  source: z.enum(["spotify_api", "cache"]),
  cache_path: z.string().min(1),
  fetched_at: z.string().min(1),
  devices: z.array(spotifyDeviceSchema)
});

const spotifyPlaylistSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  uri: z.string().min(1),
  owner_name: z.string().min(1).nullable(),
  track_count: z.number().int().nonnegative().nullable(),
  is_public: z.boolean().nullable()
});

const spotifyTrackSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  uri: z.string().min(1),
  artists: z.array(z.string().min(1))
});

const spotifyListPlaylistsInputSchema = z.object({});

const spotifyListPlaylistsOutputSchema = z.object({
  ok: z.literal(true),
  playlists: z.array(spotifyPlaylistSchema)
});

const spotifyAddTracksToPlaylistInputSchema = z.object({
  playlist: z.string().min(1),
  tracks: z.array(z.string().min(1)).min(1).max(100),
  position: z.number().int().nonnegative().nullable()
});

const spotifyAddTracksToPlaylistOutputSchema = z.object({
  ok: z.literal(true),
  playlist: spotifyPlaylistSchema,
  tracks: z.array(spotifyTrackSchema),
  snapshot_id: z.string().min(1).nullable()
});

const spotifyPlayPlaylistInputSchema = z.object({
  playlist: z.string().min(1),
  track: z.string().min(1).nullable(),
  device: z.string().min(1).nullable()
});

const spotifyPlayPlaylistOutputSchema = z.object({
  ok: z.literal(true),
  playlist: spotifyPlaylistSchema,
  track: spotifyTrackSchema.nullable()
});

type SpotifyPlayInput = z.infer<typeof spotifyPlayInputSchema>;
type SpotifyPlayOutput = z.infer<typeof spotifyPlayOutputSchema>;
type SpotifyPauseInput = z.infer<typeof spotifyPauseInputSchema>;
type SpotifyPauseOutput = z.infer<typeof spotifyPauseOutputSchema>;
type SpotifyResumeInput = z.infer<typeof spotifyResumeInputSchema>;
type SpotifyResumeOutput = z.infer<typeof spotifyResumeOutputSchema>;
type SpotifyListDevicesInput = z.infer<typeof spotifyListDevicesInputSchema>;
type SpotifyListDevicesOutput = z.infer<typeof spotifyListDevicesOutputSchema>;
type SpotifyListPlaylistsInput = z.infer<typeof spotifyListPlaylistsInputSchema>;
type SpotifyListPlaylistsOutput = z.infer<typeof spotifyListPlaylistsOutputSchema>;
type SpotifyAddTracksToPlaylistInput = z.infer<
  typeof spotifyAddTracksToPlaylistInputSchema
>;
type SpotifyAddTracksToPlaylistOutput = z.infer<
  typeof spotifyAddTracksToPlaylistOutputSchema
>;
type SpotifyPlayPlaylistInput = z.infer<typeof spotifyPlayPlaylistInputSchema>;
type SpotifyPlayPlaylistOutput = z.infer<typeof spotifyPlayPlaylistOutputSchema>;

interface AssistantAudioBridgeSpotifyToolOptions {
  spotifyClient: AssistantAudioBridgeSpotifyClient | null;
  spotifyDevicesCachePath: string;
}

const blockAfterReminderSchedulePolicy = {
  blockedByMarkers: {
    markers: [cronReminderScheduledTurnMarker],
    message:
      "A future reminder was already scheduled in this turn. Do not execute Spotify playback now; wait for the cron reminder tick."
  }
};

export const assistantAudioBridgeSpotifyToolNames = {
  listDevices: "assistant_bridge_spotify_list_devices",
  play: "assistant_bridge_spotify_play",
  pause: "assistant_bridge_spotify_pause",
  resume: "assistant_bridge_spotify_resume",
  listPlaylists: "assistant_bridge_spotify_list_playlists",
  addTracksToPlaylist: "assistant_bridge_spotify_add_tracks_to_playlist",
  playPlaylist: "assistant_bridge_spotify_play_playlist"
} as const;

export function createAssistantAudioBridgeSpotifyTools(
  options: AssistantAudioBridgeSpotifyToolOptions
): ToolDefinition[] {
  return [
    createSpotifyListDevicesTool(options),
    createSpotifyPlayTool(options),
    createSpotifyPauseTool(options),
    createSpotifyResumeTool(options),
    createSpotifyListPlaylistsTool(options),
    createSpotifyAddTracksToPlaylistTool(options),
    createSpotifyPlayPlaylistTool(options)
  ];
}

function createSpotifyListDevicesTool(
  options: AssistantAudioBridgeSpotifyToolOptions
): ToolDefinition<SpotifyListDevicesInput, SpotifyListDevicesOutput> {
  return {
    name: assistantAudioBridgeSpotifyToolNames.listDevices,
    description:
      "List available Spotify playback devices and persist them to the assistant bridge device cache. Set refresh=true to fetch from Spotify API, or refresh=false to read cached devices first.",
    inputSchema: spotifyListDevicesInputSchema,
    outputSchema: spotifyListDevicesOutputSchema,
    sideEffecting: false,
    approvalRequired: false,
    idempotent: false,
    turnPolicy: blockAfterReminderSchedulePolicy,
    async execute(input) {
      const spotifyClient = requireSpotifyClient(options.spotifyClient);
      const cached = await readSpotifyDeviceCache(options.spotifyDevicesCachePath);

      if (input.refresh) {
        try {
          return await refreshSpotifyDeviceCache(spotifyClient, options);
        } catch (error) {
          if (cached !== null) {
            return {
              ok: true,
              source: "cache",
              cache_path: options.spotifyDevicesCachePath,
              fetched_at: cached.fetched_at,
              devices: cached.devices
            };
          }

          throw augmentSpotifyDeviceError(error);
        }
      }

      if (cached !== null) {
        return {
          ok: true,
          source: "cache",
          cache_path: options.spotifyDevicesCachePath,
          fetched_at: cached.fetched_at,
          devices: cached.devices
        };
      }

      return await refreshSpotifyDeviceCache(spotifyClient, options);
    }
  };
}

function createSpotifyPlayTool(
  options: AssistantAudioBridgeSpotifyToolOptions
): ToolDefinition<SpotifyPlayInput, SpotifyPlayOutput> {
  return {
    name: assistantAudioBridgeSpotifyToolNames.play,
    description:
      "Resume Spotify playback, or search and play a track when query is provided.",
    inputSchema: spotifyPlayInputSchema,
    outputSchema: spotifyPlayOutputSchema,
    sideEffecting: true,
    approvalRequired: false,
    idempotent: false,
    turnPolicy: blockAfterReminderSchedulePolicy,
    async execute(input) {
      const spotifyClient = requireSpotifyClient(options.spotifyClient);
      const deviceHint = input.device ?? undefined;

      try {
        if (input.query) {
          const track = await spotifyClient.playFromQuery(input.query, deviceHint);

          return {
            ok: true,
            mode: "search_play",
            track_name: track.name,
            track_uri: track.uri,
            artists: track.artists
          };
        }

        await spotifyClient.resume(deviceHint);

        return {
          ok: true,
          mode: "resume",
          track_name: null,
          track_uri: null,
          artists: null
        };
      } catch (error) {
        throw augmentSpotifyDeviceError(error);
      }
    }
  };
}

function createSpotifyPauseTool(
  options: AssistantAudioBridgeSpotifyToolOptions
): ToolDefinition<SpotifyPauseInput, SpotifyPauseOutput> {
  return {
    name: assistantAudioBridgeSpotifyToolNames.pause,
    description: "Pause Spotify playback.",
    inputSchema: spotifyPauseInputSchema,
    outputSchema: spotifyPauseOutputSchema,
    sideEffecting: true,
    approvalRequired: false,
    idempotent: false,
    turnPolicy: blockAfterReminderSchedulePolicy,
    async execute(input) {
      const spotifyClient = requireSpotifyClient(options.spotifyClient);
      const pauseResult = await spotifyClient.pauseAndWaitForStop(
        input.device ?? undefined
      ).catch((error: unknown) => {
        throw augmentSpotifyDeviceError(error);
      });

      if (!pauseResult.paused) {
        throw new Error("Spotify pause command did not take effect.");
      }

      return {
        ok: true
      };
    }
  };
}

function createSpotifyResumeTool(
  options: AssistantAudioBridgeSpotifyToolOptions
): ToolDefinition<SpotifyResumeInput, SpotifyResumeOutput> {
  return {
    name: assistantAudioBridgeSpotifyToolNames.resume,
    description: "Resume Spotify playback.",
    inputSchema: spotifyResumeInputSchema,
    outputSchema: spotifyResumeOutputSchema,
    sideEffecting: true,
    approvalRequired: false,
    idempotent: false,
    turnPolicy: blockAfterReminderSchedulePolicy,
    async execute(input) {
      const spotifyClient = requireSpotifyClient(options.spotifyClient);

      try {
        await spotifyClient.resumeWithFallback(input.device ?? undefined);
      } catch (error) {
        throw augmentSpotifyDeviceError(error);
      }

      return {
        ok: true
      };
    }
  };
}

function createSpotifyListPlaylistsTool(
  options: AssistantAudioBridgeSpotifyToolOptions
): ToolDefinition<SpotifyListPlaylistsInput, SpotifyListPlaylistsOutput> {
  return {
    name: assistantAudioBridgeSpotifyToolNames.listPlaylists,
    description:
      "List the current user's Spotify playlists. Includes owned and followed playlists visible to the authorized account.",
    inputSchema: spotifyListPlaylistsInputSchema,
    outputSchema: spotifyListPlaylistsOutputSchema,
    sideEffecting: false,
    approvalRequired: false,
    idempotent: false,
    turnPolicy: blockAfterReminderSchedulePolicy,
    async execute() {
      const spotifyClient = requireSpotifyClient(options.spotifyClient);
      const playlists = await spotifyClient.listPlaylists();

      return {
        ok: true,
        playlists: playlists.map(toPlaylistPayload)
      };
    }
  };
}

function createSpotifyAddTracksToPlaylistTool(
  options: AssistantAudioBridgeSpotifyToolOptions
): ToolDefinition<
  SpotifyAddTracksToPlaylistInput,
  SpotifyAddTracksToPlaylistOutput
> {
  return {
    name: assistantAudioBridgeSpotifyToolNames.addTracksToPlaylist,
    description:
      "Add one or more Spotify tracks to a playlist. The playlist can be a playlist id, URI, or unambiguous playlist name; each track can be a Spotify track URI or search query.",
    inputSchema: spotifyAddTracksToPlaylistInputSchema,
    outputSchema: spotifyAddTracksToPlaylistOutputSchema,
    sideEffecting: true,
    approvalRequired: false,
    idempotent: false,
    turnPolicy: blockAfterReminderSchedulePolicy,
    async execute(input) {
      const spotifyClient = requireSpotifyClient(options.spotifyClient);
      const result = await spotifyClient.addTracksToPlaylist({
        playlist: input.playlist,
        tracks: input.tracks,
        position: input.position ?? undefined
      });

      return {
        ok: true,
        playlist: toPlaylistPayload(result.playlist),
        tracks: result.tracks.map(toTrackPayload),
        snapshot_id: result.snapshotId
      };
    }
  };
}

function createSpotifyPlayPlaylistTool(
  options: AssistantAudioBridgeSpotifyToolOptions
): ToolDefinition<SpotifyPlayPlaylistInput, SpotifyPlayPlaylistOutput> {
  return {
    name: assistantAudioBridgeSpotifyToolNames.playPlaylist,
    description:
      "Start Spotify playback from a playlist, optionally offset to a matching track in that playlist. Requires Spotify Premium for playback control.",
    inputSchema: spotifyPlayPlaylistInputSchema,
    outputSchema: spotifyPlayPlaylistOutputSchema,
    sideEffecting: true,
    approvalRequired: false,
    idempotent: false,
    turnPolicy: blockAfterReminderSchedulePolicy,
    async execute(input) {
      const spotifyClient = requireSpotifyClient(options.spotifyClient);
      const result = await spotifyClient.playPlaylist({
        playlist: input.playlist,
        track: input.track ?? undefined,
        deviceHint: input.device ?? undefined
      });

      return {
        ok: true,
        playlist: toPlaylistPayload(result.playlist),
        track: result.track === null ? null : toTrackPayload(result.track)
      };
    }
  };
}

const spotifyDeviceCacheSchema = z.object({
  fetched_at: z.string().min(1),
  devices: z.array(spotifyDeviceSchema)
});

type SpotifyDeviceCache = z.infer<typeof spotifyDeviceCacheSchema>;

async function refreshSpotifyDeviceCache(
  spotifyClient: AssistantAudioBridgeSpotifyClient,
  options: AssistantAudioBridgeSpotifyToolOptions
): Promise<SpotifyListDevicesOutput> {
  const fetchedAt = new Date().toISOString();
  const devices = (await spotifyClient.listDevices()).map(toDevicePayload);
  const cache = {
    fetched_at: fetchedAt,
    devices
  };

  await writeSpotifyDeviceCache(options.spotifyDevicesCachePath, cache);

  return {
    ok: true,
    source: "spotify_api",
    cache_path: options.spotifyDevicesCachePath,
    fetched_at: fetchedAt,
    devices
  };
}

function toDevicePayload(
  device: AssistantAudioBridgeSpotifyDevice
): z.infer<typeof spotifyDeviceSchema> {
  return {
    id: device.id,
    name: device.name,
    is_active: device.isActive,
    type: device.type
  };
}

function toPlaylistPayload(
  playlist: AssistantAudioBridgeSpotifyPlaylist
): z.infer<typeof spotifyPlaylistSchema> {
  return {
    id: playlist.id,
    name: playlist.name,
    uri: playlist.uri,
    owner_name: playlist.ownerName,
    track_count: playlist.trackCount,
    is_public: playlist.isPublic
  };
}

function toTrackPayload(
  track: AssistantAudioBridgeSpotifyTrack
): z.infer<typeof spotifyTrackSchema> {
  return {
    id: track.id,
    name: track.name,
    uri: track.uri,
    artists: track.artists
  };
}

async function readSpotifyDeviceCache(
  cachePath: string
): Promise<SpotifyDeviceCache | null> {
  try {
    const raw = await fs.readFile(cachePath, "utf8");
    return spotifyDeviceCacheSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

async function writeSpotifyDeviceCache(
  cachePath: string,
  cache: SpotifyDeviceCache
): Promise<void> {
  await fs.mkdir(dirname(cachePath), {
    recursive: true
  });
  await fs.writeFile(cachePath, `${JSON.stringify(cache, null, 2)}\n`, {
    encoding: "utf8"
  });
}

function augmentSpotifyDeviceError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);

  if (!message.toLowerCase().includes("device")) {
    return error instanceof Error ? error : new Error(message);
  }

  return new Error(
    `${message} Call assistant_bridge_spotify_list_devices with refresh=true, then retry with a concrete device id.`
  );
}

function requireSpotifyClient(
  client: AssistantAudioBridgeSpotifyClient | null
): AssistantAudioBridgeSpotifyClient {
  if (client === null) {
    throw new Error(
      "Assistant audio bridge Spotify client is not configured. Set ASSISTANT_AUDIO_BRIDGE_SPOTIFY_CLIENT_ID."
    );
  }

  return client;
}
