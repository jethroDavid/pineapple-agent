import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";

import {
  agentManifestSchema,
  type LoadedAgentManifest
} from "./agent-manifest.js";

export async function loadAgentManifests(definitionsDir: string): Promise<LoadedAgentManifest[]> {
  const entryNames = await readdir(definitionsDir, {
    withFileTypes: true
  });
  const manifests: LoadedAgentManifest[] = [];

  for (const entry of entryNames) {
    if (!entry.isFile() || extname(entry.name) !== ".json") {
      continue;
    }

    const manifestPath = resolve(definitionsDir, entry.name);
    const rawManifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const parsedManifest = agentManifestSchema.parse(rawManifest);
    const instructionsPath = resolve(dirname(manifestPath), parsedManifest.instructionsFile);
    const instructions = (await readFile(instructionsPath, "utf8")).trim();

    manifests.push({
      ...parsedManifest,
      manifestPath,
      instructionsPath,
      instructions
    });
  }

  if (manifests.length === 0) {
    throw new Error(`No agent manifests were found in ${definitionsDir}.`);
  }

  const ids = new Set<string>();
  const entrypoints = manifests.filter((manifest) => manifest.entrypoint);

  for (const manifest of manifests) {
    if (ids.has(manifest.id)) {
      throw new Error(`Agent manifest ${manifest.id} is defined more than once.`);
    }

    ids.add(manifest.id);
  }

  if (entrypoints.length === 0) {
    throw new Error("At least one agent manifest must declare entrypoint=true.");
  }

  if (entrypoints.length > 1) {
    throw new Error("Only one agent manifest may declare entrypoint=true.");
  }

  for (const manifest of manifests) {
    for (const handoffId of manifest.handoffs) {
      if (!ids.has(handoffId)) {
        throw new Error(`Agent ${manifest.id} references unknown handoff ${handoffId}.`);
      }
    }
  }

  return manifests.sort((left, right) => left.id.localeCompare(right.id));
}
