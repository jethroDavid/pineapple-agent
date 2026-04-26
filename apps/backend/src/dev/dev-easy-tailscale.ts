import { buildDevEasyRequiredProxyTarget } from "./dev-easy-config.js";
import { defaultBackendPort } from "../config/network-defaults.js";

export interface DevEasyCommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  errorCode?: string;
}

export type DevEasyCommandRunner = (
  command: string,
  args: string[]
) => Promise<DevEasyCommandResult>;

export interface TailscaleFunnelPreflightOptions {
  runCommand: DevEasyCommandRunner;
  requiredProxyTarget?: string;
  autoEnableFunnelWhenMissing?: boolean;
}

export interface TailscaleFunnelPreflightResult {
  baseUrl: string;
  funnelAutoEnabled: boolean;
}

interface FunnelWebRoute {
  hostPort: string;
  path: string;
  proxyTarget: string | null;
}

interface ParsedFunnelStatus {
  allowFunnelHostPorts: Set<string>;
  webRoutes: FunnelWebRoute[];
}

export async function ensureTailscaleFunnelPreflight(
  options: TailscaleFunnelPreflightOptions
): Promise<TailscaleFunnelPreflightResult> {
  await assertTailscaleCliAvailable(options.runCommand);
  await assertTailscaleRunning(options.runCommand);
  const requiredProxyTarget =
    options.requiredProxyTarget ?? buildDevEasyRequiredProxyTarget();

  let funnelStatus = await runJsonCommand(
    options.runCommand,
    "tailscale",
    ["funnel", "status", "--json"],
    "Failed to read Tailscale Funnel status."
  );
  let funnelAutoEnabled = false;

  if (options.autoEnableFunnelWhenMissing && !funnelIsEnabled(funnelStatus)) {
    const commandHintPort =
      extractPortFromProxyTarget(requiredProxyTarget) ?? defaultBackendPort;
    const enableResult = await options.runCommand("tailscale", [
      "funnel",
      "--bg",
      String(commandHintPort)
    ]);

    if (enableResult.exitCode !== 0) {
      throw new Error(
        `Tailscale Funnel is not enabled and \`tailscale funnel --bg ${commandHintPort}\` failed: ${formatCommandFailure(enableResult)}`
      );
    }

    funnelAutoEnabled = true;
    funnelStatus = await runJsonCommand(
      options.runCommand,
      "tailscale",
      ["funnel", "status", "--json"],
      "Failed to re-check Tailscale Funnel status after `tailscale funnel --bg`."
    );
  }

  const host = resolveFunnelHostFromStatus(funnelStatus, requiredProxyTarget);
  return {
    baseUrl: `https://${host}`,
    funnelAutoEnabled
  };
}

export function tailscaleStatusIsRunning(status: unknown): boolean {
  if (!isRecord(status)) {
    return false;
  }

  if (
    typeof status.BackendState === "string" &&
    status.BackendState.trim().toLowerCase() === "running"
  ) {
    return true;
  }

  const self = status.Self;
  return isRecord(self) && self.Online === true;
}

export function resolveFunnelHostFromStatus(
  rawStatus: unknown,
  requiredProxyTarget: string
): string {
  const status = parseFunnelStatus(rawStatus);
  const funnelHostPorts = getFunnelHostPorts(status);

  if (funnelHostPorts.length === 0) {
    const commandHintPort =
      extractPortFromProxyTarget(requiredProxyTarget) ?? defaultBackendPort;
    throw new Error(
      `Tailscale Funnel is not enabled. Enable it first with \`tailscale funnel --bg ${commandHintPort}\`.`
    );
  }

  const rootRoutes = status.webRoutes.filter(
    (route) => route.path === "/" && funnelHostPorts.includes(route.hostPort)
  );

  if (rootRoutes.length === 0) {
    throw new Error(
      `Tailscale Funnel must expose '/' and proxy it to ${requiredProxyTarget}.`
    );
  }

  const normalizedRequiredTarget = normalizeProxyTarget(requiredProxyTarget);
  const matchingRoute = rootRoutes.find(
    (route) => normalizeProxyTarget(route.proxyTarget) === normalizedRequiredTarget
  );

  if (!matchingRoute) {
    const observedTargets = rootRoutes
      .map((route) => route.proxyTarget ?? "<missing proxy>")
      .join(", ");
    throw new Error(
      `Tailscale Funnel '/' must proxy to ${requiredProxyTarget}. Current target(s): ${observedTargets}`
    );
  }

  const host = extractHostFromHostPort(matchingRoute.hostPort);
  if (!host) {
    throw new Error(
      `Unable to derive Funnel host from '${matchingRoute.hostPort}'.`
    );
  }

  return host;
}

async function assertTailscaleCliAvailable(
  runCommand: DevEasyCommandRunner
): Promise<void> {
  const result = await runCommand("tailscale", ["version"]);

  if (result.errorCode === "ENOENT") {
    throw new Error(
      "Tailscale CLI is not installed. Install it with `winget install --id Tailscale.Tailscale -e`."
    );
  }

  if (result.exitCode !== 0) {
    throw new Error(
      `Failed to run \`tailscale version\`: ${formatCommandFailure(result)}`
    );
  }
}

async function assertTailscaleRunning(
  runCommand: DevEasyCommandRunner
): Promise<void> {
  const status = await runJsonCommand(
    runCommand,
    "tailscale",
    ["status", "--json"],
    "Failed to read Tailscale status."
  );

  if (tailscaleStatusIsRunning(status)) {
    return;
  }

  const upResult = await runCommand("tailscale", ["up"]);
  if (upResult.exitCode !== 0) {
    throw new Error(
      `Tailscale is not running and \`tailscale up\` failed: ${formatCommandFailure(upResult)}`
    );
  }

  const recheckStatus = await runJsonCommand(
    runCommand,
    "tailscale",
    ["status", "--json"],
    "Failed to re-check Tailscale status after `tailscale up`."
  );

  if (!tailscaleStatusIsRunning(recheckStatus)) {
    throw new Error(
      "Tailscale is still not running after `tailscale up`. Open Tailscale and sign in, then rerun `pnpm dev:easy`."
    );
  }
}

async function runJsonCommand(
  runCommand: DevEasyCommandRunner,
  command: string,
  args: string[],
  prefix: string
): Promise<unknown> {
  const result = await runCommand(command, args);

  if (result.exitCode !== 0) {
    throw new Error(`${prefix} ${formatCommandFailure(result)}`);
  }

  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`${prefix} Command output was not valid JSON.`);
  }
}

function parseFunnelStatus(rawStatus: unknown): ParsedFunnelStatus {
  const root = findServeConfigRoot(rawStatus);
  const allowFunnelHostPorts = extractAllowFunnelHostPorts(root);
  const webRoutes = extractWebRoutes(root);

  return {
    allowFunnelHostPorts,
    webRoutes
  };
}

function funnelIsEnabled(rawStatus: unknown): boolean {
  const status = parseFunnelStatus(rawStatus);
  return getFunnelHostPorts(status).length > 0;
}

function findServeConfigRoot(rawStatus: unknown): Record<string, unknown> {
  if (!isRecord(rawStatus)) {
    return {};
  }

  const candidates: unknown[] = [
    rawStatus,
    rawStatus.ServeConfig,
    rawStatus.Config,
    rawStatus.CurrentConfig,
    rawStatus.Status
  ];

  for (const candidate of candidates) {
    if (isRecord(candidate) && (isRecord(candidate.Web) || isRecord(candidate.AllowFunnel))) {
      return candidate;
    }
  }

  return rawStatus;
}

function extractAllowFunnelHostPorts(root: Record<string, unknown>): Set<string> {
  const allowFunnelHostPorts = new Set<string>();
  const allowFunnel = root.AllowFunnel;

  if (!isRecord(allowFunnel)) {
    return allowFunnelHostPorts;
  }

  for (const [hostPort, enabled] of Object.entries(allowFunnel)) {
    if (enabled === true) {
      allowFunnelHostPorts.add(hostPort);
    }
  }

  return allowFunnelHostPorts;
}

function extractWebRoutes(root: Record<string, unknown>): FunnelWebRoute[] {
  const web = root.Web;

  if (!isRecord(web)) {
    return [];
  }

  const routes: FunnelWebRoute[] = [];

  for (const [hostPort, hostConfig] of Object.entries(web)) {
    if (!isRecord(hostConfig)) {
      continue;
    }

    const handlers = hostConfig.Handlers;
    if (!isRecord(handlers)) {
      continue;
    }

    for (const [path, handler] of Object.entries(handlers)) {
      if (!isRecord(handler)) {
        continue;
      }

      routes.push({
        hostPort,
        path: normalizeRoutePath(path),
        proxyTarget: typeof handler.Proxy === "string" ? handler.Proxy : null
      });
    }
  }

  return routes;
}

function getFunnelHostPorts(status: ParsedFunnelStatus): string[] {
  if (status.allowFunnelHostPorts.size > 0) {
    return [...status.allowFunnelHostPorts];
  }

  const hostPorts = new Set<string>();
  for (const route of status.webRoutes) {
    hostPorts.add(route.hostPort);
  }

  return [...hostPorts];
}

function extractHostFromHostPort(hostPort: string): string | null {
  const trimmed = hostPort.trim();

  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("[") && trimmed.includes("]:")) {
    return trimmed.slice(1, trimmed.lastIndexOf("]:"));
  }

  const separatorIndex = trimmed.lastIndexOf(":");
  if (separatorIndex === -1) {
    return trimmed;
  }

  return trimmed.slice(0, separatorIndex);
}

function normalizeRoutePath(path: string): string {
  if (path === "") {
    return "/";
  }

  if (!path.startsWith("/")) {
    return `/${path}`;
  }

  return path;
}

function normalizeProxyTarget(target: string | null): string | null {
  if (target === null) {
    return null;
  }

  const trimmed = target.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = new URL(trimmed);
    const pathname = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/+$/u, "");
    return `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}${pathname}`;
  } catch {
    return trimmed;
  }
}

function extractPortFromProxyTarget(target: string): number | null {
  try {
    const parsed = new URL(target);
    const port = Number.parseInt(parsed.port, 10);
    if (Number.isInteger(port) && port > 0 && port <= 65_535) {
      return port;
    }
  } catch {
    return null;
  }

  return null;
}

function formatCommandFailure(result: DevEasyCommandResult): string {
  if (result.errorCode === "ENOENT") {
    return "command was not found.";
  }

  const stderr = result.stderr.trim();
  const stdout = result.stdout.trim();
  const details = stderr || stdout || "no error output";
  return `${details} (exit code: ${result.exitCode ?? "unknown"})`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
