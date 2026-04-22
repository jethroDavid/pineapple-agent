import { describe, expect, it } from "vitest";

import { toHostedTools } from "../../src/agents/runtime/agent-runtime-hosted-tool.js";

describe("toHostedTools", () => {
  it("maps web_search manifest config into an OpenAI hosted tool", () => {
    const tools = toHostedTools([
      {
        type: "web_search",
        searchContextSize: "low",
        externalWebAccess: false,
        allowedDomains: ["openai.com"]
      }
    ]);

    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({
      type: "hosted_tool",
      name: "web_search",
      providerData: {
        type: "web_search",
        search_context_size: "low",
        external_web_access: false,
        filters: {
          allowed_domains: ["openai.com"]
        }
      }
    });
  });

  it("returns an empty array when no hosted tools are configured", () => {
    expect(toHostedTools(undefined)).toEqual([]);
  });
});
