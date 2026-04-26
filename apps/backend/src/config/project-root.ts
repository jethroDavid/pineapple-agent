import { existsSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

const projectRootMarkers = ["pnpm-workspace.yaml", ".git"];

export function resolveProjectRoot(options: {
  configuredProjectRoot?: string;
  cwd?: string;
} = {}): string {
  const cwd = resolve(options.cwd ?? process.cwd());
  const configuredProjectRoot = options.configuredProjectRoot?.trim();

  if (configuredProjectRoot) {
    return isAbsolute(configuredProjectRoot)
      ? resolve(configuredProjectRoot)
      : resolve(cwd, configuredProjectRoot);
  }

  return findNearestProjectRoot(cwd) ?? cwd;
}

function findNearestProjectRoot(cwd: string): string | null {
  let current = cwd;

  while (true) {
    if (projectRootMarkers.some((marker) => existsSync(resolve(current, marker)))) {
      return current;
    }

    const parent = dirname(current);

    if (parent === current) {
      return null;
    }

    current = parent;
  }
}
