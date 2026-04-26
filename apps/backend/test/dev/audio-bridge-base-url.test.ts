import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

interface AudioBridgeBaseUrlModule {
  resolveAssistantAudioBridgeBaseUrl(input: {
    apiBaseUrl?: string | null;
    bundlerHost?: string | null;
    platformOs?: string | null;
  }): string;
}

describe("resolveAssistantAudioBridgeBaseUrl", () => {
  it("prioritizes EXPO_PUBLIC_API_BASE_URL", async () => {
    const module = await loadMobileBaseUrlModule();
    const resolved = module.resolveAssistantAudioBridgeBaseUrl({
      apiBaseUrl: "https://api.example.com/api",
      bundlerHost: "192.168.1.10",
      platformOs: "android"
    });

    expect(resolved).toBe("https://api.example.com");
  });

  it("falls back to bundler host when API base URL is unset", async () => {
    const module = await loadMobileBaseUrlModule();
    const resolved = module.resolveAssistantAudioBridgeBaseUrl({
      apiBaseUrl: "",
      bundlerHost: "192.168.1.10",
      platformOs: "android"
    });

    expect(resolved).toBe("http://192.168.1.10:3000");
  });

  it("falls back to local resolver when no explicit env URL is provided", async () => {
    const module = await loadMobileBaseUrlModule();
    const resolved = module.resolveAssistantAudioBridgeBaseUrl({
      apiBaseUrl: "",
      bundlerHost: "localhost",
      platformOs: "android"
    });

    expect(resolved).toBe("http://10.0.2.2:3000");
  });
});

async function loadMobileBaseUrlModule(): Promise<AudioBridgeBaseUrlModule> {
  const modulePath = resolve(
    process.cwd(),
    "../mobile/src/lib/audio-bridge-base-url.ts"
  );
  const moduleUrl = pathToFileURL(modulePath).toString();
  return (await import(moduleUrl)) as AudioBridgeBaseUrlModule;
}
