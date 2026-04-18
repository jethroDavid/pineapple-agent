import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";

import {
  extractCodexProviderDataFromFunctionResultOutput,
  toCodexAgentToolOutput
} from "../../src/agents/providers/codex-mcp-provider-codec.js";

describe("codex-mcp-provider-codec", () => {
  it("maps structured Codex content to tool output text and providerData", () => {
    const result = CallToolResultSchema.parse({
      structuredContent: {
        threadId: "codex-thread-1",
        content: "Structured summary"
      },
      content: [
        {
          type: "text",
          text: "Fallback summary"
        }
      ]
    });

    expect(toCodexAgentToolOutput(result)).toEqual({
      type: "text",
      text: "Structured summary",
      providerData: {
        codex: {
          threadId: "codex-thread-1",
          content: "Structured summary"
        }
      }
    });
  });

  it("falls back to text content when structured content text is missing", () => {
    const result = CallToolResultSchema.parse({
      structuredContent: {
        threadId: "codex-thread-1"
      },
      content: [
        {
          type: "text",
          text: "Fallback summary"
        }
      ]
    });

    expect(toCodexAgentToolOutput(result)).toEqual({
      type: "text",
      text: "Fallback summary",
      providerData: {
        codex: {
          threadId: "codex-thread-1"
        }
      }
    });
  });

  it("serializes content when no text output exists", () => {
    const result = CallToolResultSchema.parse({
      content: [
        {
          type: "image",
          data: "aGVsbG8=",
          mimeType: "image/png"
        }
      ]
    });

    expect(toCodexAgentToolOutput(result)).toEqual({
      type: "text",
      text: JSON.stringify(result.content)
    });
  });

  it("extracts codex provider data from function call result output", () => {
    expect(
      extractCodexProviderDataFromFunctionResultOutput([
        {
          type: "input_text",
          text: "ignored"
        },
        {
          type: "input_text",
          text: "persist",
          providerData: {
            codex: {
              threadId: "codex-thread-2",
              cursor: "next"
            }
          }
        }
      ])
    ).toEqual({
      threadId: "codex-thread-2",
      cursor: "next"
    });
  });

  it("returns null when codex provider data is not present", () => {
    expect(extractCodexProviderDataFromFunctionResultOutput("not-an-array")).toBeNull();
    expect(
      extractCodexProviderDataFromFunctionResultOutput([
        {
          type: "input_text",
          text: "no provider data"
        }
      ])
    ).toBeNull();
  });
});
