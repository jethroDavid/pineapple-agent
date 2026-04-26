import { promises as fs } from "node:fs";
import { dirname } from "node:path";

export interface SyncMobileEnvForDevEasyOptions {
  envFilePath: string;
  baseUrl: string;
}

const easyDevEnvKeys = [
  "EXPO_PUBLIC_API_BASE_URL"
] as const;
const removedEnvKeys = ["EXPO_PUBLIC_TAILSCALE_BASE_URL"] as const;

export async function syncMobileEnvForDevEasy(
  options: SyncMobileEnvForDevEasyOptions
): Promise<void> {
  const nextContent = await buildUpdatedEnvContent(options);
  await fs.mkdir(dirname(options.envFilePath), {
    recursive: true
  });
  await fs.writeFile(options.envFilePath, nextContent, "utf8");
}

export async function buildUpdatedEnvContent(
  options: SyncMobileEnvForDevEasyOptions
): Promise<string> {
  const currentContent = await readFileIfExists(options.envFilePath);
  const lineBreak = currentContent?.includes("\r\n") ? "\r\n" : "\n";
  const lines = (currentContent ?? "").split(/\r?\n/);

  if (lines.length === 1 && lines[0] === "") {
    lines.length = 0;
  }

  removeEnvLines(lines, removedEnvKeys);

  for (const key of easyDevEnvKeys) {
    upsertEnvLine(lines, key, options.baseUrl);
  }

  return `${lines.join(lineBreak).replace(/\s+$/u, "")}${lineBreak}`;
}

function upsertEnvLine(lines: string[], key: string, value: string): void {
  const expectedPrefix = `${key}=`;
  const lineIndex = lines.findIndex((line) =>
    line.trimStart().startsWith(expectedPrefix)
  );

  if (lineIndex >= 0) {
    lines[lineIndex] = `${key}=${value}`;
    return;
  }

  lines.push(`${key}=${value}`);
}

function removeEnvLines(lines: string[], keys: readonly string[]): void {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index] ?? "";

    if (keys.some((key) => line.trimStart().startsWith(`${key}=`))) {
      lines.splice(index, 1);
    }
  }
}

async function readFileIfExists(path: string): Promise<string | null> {
  try {
    return await fs.readFile(path, "utf8");
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return null;
    }

    throw error;
  }
}
