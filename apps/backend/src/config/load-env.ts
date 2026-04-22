import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { config as loadDotenv } from "dotenv";

let loaded = false;

export function loadEnvFile(): void {
  if (loaded) {
    return;
  }

  const cwd = process.cwd();
  const candidatePaths = [
    resolve(cwd, ".env"),
    resolve(cwd, "../../.env")
  ];

  for (const path of candidatePaths) {
    if (!existsSync(path)) {
      continue;
    }

    loadDotenv({
      path,
      override: false
    });
  }

  loaded = true;
}
