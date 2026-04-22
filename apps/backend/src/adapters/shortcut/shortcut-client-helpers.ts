export function normalizeShortcutIdentifier(value: string | number): string {
  return String(value);
}

export function getShortcutIntegrationIdFromLocation(location: string | null): string | null {
  if (location === null) {
    return null;
  }

  const normalizedLocation = location.trim();

  if (normalizedLocation.length === 0) {
    return null;
  }

  const segments = normalizedLocation.split("/").filter(Boolean);
  return segments.at(-1) ?? null;
}

export async function readShortcutResponseBody(response: Response): Promise<string> {
  if (typeof response.text === "function") {
    return await response.text();
  }

  if (typeof response.json === "function") {
    return JSON.stringify(await response.json());
  }

  return "";
}
