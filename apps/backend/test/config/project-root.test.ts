import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { resolveProjectRoot } from "../../src/config/project-root.js";

describe("resolveProjectRoot", () => {
  it("uses an explicit configured project root", async () => {
    const root = await mkdtemp(join(tmpdir(), "pineapple-configured-root-"));
    const backendDir = join(root, "apps", "backend");
    await mkdir(backendDir, {
      recursive: true
    });

    expect(
      resolveProjectRoot({
        configuredProjectRoot: "../..",
        cwd: backendDir
      })
    ).toBe(root);
  });

  it("falls back to the nearest workspace root", async () => {
    const root = await mkdtemp(join(tmpdir(), "pineapple-root-"));
    const backendDir = join(root, "apps", "backend");
    await mkdir(backendDir, {
      recursive: true
    });
    await writeFile(join(root, "pnpm-workspace.yaml"), "packages: []\n", "utf8");

    expect(
      resolveProjectRoot({
        cwd: backendDir
      })
    ).toBe(root);
  });
});
