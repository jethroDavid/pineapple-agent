import { describe, expect, it } from "vitest";

import {
  defaultSpotifyRedirectUri,
  resolveSpotifyRedirectUri
} from "../../src/adapters/assistant-audio-bridge/assistant-audio-bridge-spotify-auth.js";

describe("resolveSpotifyRedirectUri", () => {
  it("returns default redirect uri when unset", () => {
    expect(resolveSpotifyRedirectUri(undefined)).toBe(defaultSpotifyRedirectUri);
  });

  it("accepts a valid custom redirect uri", () => {
    expect(resolveSpotifyRedirectUri("http://localhost:43873/spotify/callback")).toBe(
      "http://localhost:43873/spotify/callback"
    );
  });

  it("rejects redirect uri without explicit port", () => {
    expect(() => resolveSpotifyRedirectUri("http://localhost/spotify/callback")).toThrow(
      /must include an explicit port/i
    );
  });
});
