import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
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
        hostedTools: [
          {
            type: "web_search",
            searchContextSize: "low",
            externalWebAccess: false,
            allowedDomains: ["openai.com"]
          }
        ],
        handoffs: ["codex"],
        agentTools: ["codex"],
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
    expect(manifests.find((manifest) => manifest.id === "root_manager")?.hostedTools).toEqual([
      {
        type: "web_search",
        searchContextSize: "low",
        externalWebAccess: false,
        allowedDomains: ["openai.com"]
      }
    ]);
    expect(manifests.find((manifest) => manifest.id === "root_manager")?.agentTools).toEqual([
      "codex"
    ]);
    expect(manifests.find((manifest) => manifest.id === "codex")?.agentTools).toEqual([]);
    expect(manifests.find((manifest) => manifest.id === "codex")?.instructionsPath).toContain(
      "codex.md"
    );
  });

  it("rejects agent tools that reference unknown agents", async () => {
    const root = await mkdtemp(join(tmpdir(), "pineapple-agents-"));
    const promptsDir = join(root, "prompts");

    await mkdir(promptsDir);
    await writeFile(join(promptsDir, "root.md"), "Root instructions\n", "utf8");
    await writeFile(
      join(root, "root.json"),
      JSON.stringify({
        id: "root_manager",
        name: "Root Manager",
        handoffDescription: "Routes work.",
        instructionsFile: "./prompts/root.md",
        agentTools: ["missing"],
        entrypoint: true
      }),
      "utf8"
    );

    await expect(loadAgentManifests(root)).rejects.toThrow(
      "Agent root_manager references unknown agent tool missing."
    );
  });

  it("keeps the bundled root manager as a delegation-only agent", async () => {
    const manifests = await loadAgentManifests(resolve(".pineapple/agents"));
    const rootManager = manifests.find((manifest) => manifest.id === "root_manager");

    expect(rootManager?.hostedTools).toBeUndefined();
    expect(rootManager?.sessionBackend).toBeUndefined();
    expect(rootManager).toMatchObject({
      toolsets: [],
      mcpServers: [],
      handoffs: ["general_assistant", "scheduler", "codex", "assistant_audio_bridge"],
      agentTools: ["general_assistant", "scheduler", "codex", "assistant_audio_bridge"],
      entrypoint: true
    });
  });
});
