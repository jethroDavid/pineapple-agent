import {
  defaultBackendPort,
  defaultLoopbackHost
} from "../config/network-defaults.js";

export const devEasyBackendHostEnvVar = "DEV_EASY_BACKEND_HOST";
export const devEasyBackendPortEnvVar = "DEV_EASY_BACKEND_PORT";

export const defaultDevEasyBackendHost = defaultLoopbackHost;
export const defaultDevEasyBackendPort = defaultBackendPort;

export function resolveDevEasyBackendHost(
  env: NodeJS.ProcessEnv = process.env
): string {
  const configured = env[devEasyBackendHostEnvVar]?.trim();
  return configured && configured.length > 0 ? configured : defaultDevEasyBackendHost;
}

export function resolveDevEasyBackendPort(
  env: NodeJS.ProcessEnv = process.env
): number {
  const configured = env[devEasyBackendPortEnvVar]?.trim();

  if (!configured) {
    return defaultDevEasyBackendPort;
  }

  const parsed = Number.parseInt(configured, 10);

  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(`${devEasyBackendPortEnvVar} must be an integer between 1 and 65535.`);
  }

  return parsed;
}

export function buildDevEasyRequiredProxyTarget(
  env: NodeJS.ProcessEnv = process.env
): string {
  const host = resolveDevEasyBackendHost(env);
  const port = resolveDevEasyBackendPort(env);
  return `http://${host}:${port}`;
}
