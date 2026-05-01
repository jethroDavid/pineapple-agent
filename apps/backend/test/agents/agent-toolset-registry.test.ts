import { describe, expect, it } from "vitest";

import { createAgentToolsetRegistry } from "../../src/agents/agent-toolset-registry.js";

describe("createAgentToolsetRegistry", () => {
  it("tracks unavailable toolsets without making them unresolved", () => {
    const registry = createAgentToolsetRegistry([
      {
        id: "cron",
        tools: [],
        availability: "unavailable"
      },
      {
        id: "telegram",
        tools: [],
        availability: "available"
      }
    ]);

    expect(registry.isUnavailable("cron")).toBe(true);
    expect(registry.isUnavailable("telegram")).toBe(false);
    expect(registry.resolve(["cron"])).toEqual([]);
  });
});
