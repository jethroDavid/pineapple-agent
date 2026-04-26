import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  syncMobileEnvForDevEasy
} from "../../src/dev/dev-easy-mobile-env.js";

describe("syncMobileEnvForDevEasy", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs.map(async (dir) => {
        await rm(dir, {
          recursive: true,
          force: true
        });
      })
    );
    tempDirs.length = 0;
  });

  it("creates .env when missing", async () => {
    const dir = await createTempDir(tempDirs);
    const envPath = join(dir, ".env");

    await syncMobileEnvForDevEasy({
      envFilePath: envPath,
      baseUrl: "https://easy-dev.example.ts.net"
    });

    const content = await readFile(envPath, "utf8");
    expect(content).toContain(
      "EXPO_PUBLIC_API_BASE_URL=https://easy-dev.example.ts.net"
    );
  });

  it("updates existing keys and preserves unrelated entries", async () => {
    const dir = await createTempDir(tempDirs);
    const envPath = join(dir, ".env");
    await writeFile(
      envPath,
      [
        "EXPO_PUBLIC_API_BASE_URL=http://localhost:3000",
        "SOME_OTHER_KEY=keep-me",
        "EXPO_PUBLIC_TAILSCALE_BASE_URL=https://old.example.ts.net",
        ""
      ].join("\n"),
      "utf8"
    );

    await syncMobileEnvForDevEasy({
      envFilePath: envPath,
      baseUrl: "https://new.example.ts.net"
    });

    const content = await readFile(envPath, "utf8");
    expect(content).toContain("SOME_OTHER_KEY=keep-me");
    expect(content).toContain("EXPO_PUBLIC_API_BASE_URL=https://new.example.ts.net");
    expect(content).not.toContain("EXPO_PUBLIC_TAILSCALE_BASE_URL=");
    expect(content).not.toContain("old.example.ts.net");
  });

  it("is idempotent across repeated writes", async () => {
    const dir = await createTempDir(tempDirs);
    const envPath = join(dir, ".env");
    await writeFile(envPath, "SOME_OTHER_KEY=stable\n", "utf8");

    await syncMobileEnvForDevEasy({
      envFilePath: envPath,
      baseUrl: "https://same.example.ts.net"
    });
    const firstWrite = await readFile(envPath, "utf8");

    await syncMobileEnvForDevEasy({
      envFilePath: envPath,
      baseUrl: "https://same.example.ts.net"
    });
    const secondWrite = await readFile(envPath, "utf8");

    expect(secondWrite).toBe(firstWrite);
  });
});

async function createTempDir(bag: string[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "dev-easy-mobile-env-"));
  bag.push(dir);
  return dir;
}
