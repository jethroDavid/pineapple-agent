export interface ResolveAssistantAudioBridgeBaseUrlOptions {
  apiBaseUrl?: string | null;
  bundlerHost?: string | null;
  platformOs?: string | null;
}

const defaultAssistantAudioBridgePort = 3000;
const androidEmulatorHost = "10.0.2.2";
const localhostHost = "localhost";

export function resolveAssistantAudioBridgeBaseUrl(
  options: ResolveAssistantAudioBridgeBaseUrlOptions
): string {
  const explicitApiBaseUrl = normalizeOptionalUrl(options.apiBaseUrl);
  if (explicitApiBaseUrl) {
    return explicitApiBaseUrl;
  }

  return resolveDefaultApiBaseUrl({
    bundlerHost: options.bundlerHost,
    platformOs: options.platformOs
  });
}

export function normalizeBaseUrl(url: string): string {
  return url
    .trim()
    .replace(/\/+$/u, "")
    .replace(/\/api$/iu, "");
}

function normalizeOptionalUrl(url: string | null | undefined): string | null {
  if (typeof url !== "string") {
    return null;
  }

  const trimmed = url.trim();
  if (trimmed === "") {
    return null;
  }

  return normalizeBaseUrl(trimmed);
}

function resolveDefaultApiBaseUrl(options: {
  bundlerHost?: string | null;
  platformOs?: string | null;
}): string {
  const bundlerHost = normalizeBundlerHost(options.bundlerHost);

  if (bundlerHost) {
    if (options.platformOs === "android" && isLoopbackHost(bundlerHost)) {
      return buildHttpUrl(androidEmulatorHost);
    }

    return buildHttpUrl(bundlerHost);
  }

  if (options.platformOs === "android") {
    return buildHttpUrl(androidEmulatorHost);
  }

  return buildHttpUrl(localhostHost);
}

function normalizeBundlerHost(host: string | null | undefined): string | null {
  if (typeof host !== "string") {
    return null;
  }

  const trimmed = host.trim();
  return trimmed === "" ? null : trimmed;
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return normalized === localhostHost || normalized === "127.0.0.1" || normalized === "::1";
}

function buildHttpUrl(host: string): string {
  return `http://${host}:${defaultAssistantAudioBridgePort}`;
}
