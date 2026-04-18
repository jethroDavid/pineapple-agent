import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { loadAgentManifests } from "../../src/agents/load-agent-manifests.js";

describe("loadAgentManifests", () => {
  it("loads manifests, resolves prompt files, and validates handoffs", async () => {
    const root = await mkdtemp(join(tmpdir(), "pineapple-agents-"));
    const promptsDir = join(root, "prompts");

    await mkdir(promptsDir);
    await writeFile(join(promptsDir, "root.md"), "Root instructions\n", "utf8");
    await writeFile(join(promptsDir, "codex.md"), "Codex instructions\n", "utf8");
    await writeFile(
      join(root, "root.json"),
      JSON.stringify({
        id: "root_manager",
        name: "Root Manager",
        handoffDescription: "Routes work.",
        instructionsFile: "./prompts/root.md",
        handoffs: ["codex"],
        entrypoint: true
      }),
      "utf8"
    );
    await writeFile(
      join(root, "codex.json"),
      JSON.stringify({
        id: "codex",
        name: "Codex Specialist",
        handoffDescription: "Handles coding work.",
        instructionsFile: "./prompts/codex.md"
      }),
      "utf8"
    );

    const manifests = await loadAgentManifests(root);

    expect(manifests).toHaveLength(2);
    expect(manifests.find((manifest) => manifest.id === "root_manager")?.instructions).toBe(
      "Root instructions"
    );
    expect(manifests.find((manifest) => manifest.id === "codex")?.instructionsPath).toContain(
      "codex.md"
    );
  });
});
