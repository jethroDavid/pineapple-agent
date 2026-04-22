import { describe, expect, it } from "vitest";
import { z } from "zod";

import type { ToolDefinition } from "../../src/tools/tool-definition.js";
import { ToolRegistry } from "../../src/tools/tool-registry.js";

const reverseTextInputSchema = z.object({
  text: z.string().min(1)
});

const reverseTextOutputSchema = z.object({
  reversed: z.string().min(1)
});

const reverseTextTool: ToolDefinition<
  z.infer<typeof reverseTextInputSchema>,
  z.infer<typeof reverseTextOutputSchema>
> = {
  name: "reverse_text",
  description: "Reverse the provided text.",
  inputSchema: reverseTextInputSchema,
  outputSchema: reverseTextOutputSchema,
  sideEffecting: false,
  approvalRequired: false,
  idempotent: true,
  async execute(input) {
    return {
      reversed: input.text.split("").reverse().join("")
    };
  }
};

describe("ToolRegistry", () => {
  it("stores tools and exposes them by name", () => {
    const registry = new ToolRegistry([
      reverseTextTool,
      {
        ...reverseTextTool,
        name: "summarize_text"
      }
    ]);

    expect(registry.get("reverse_text")?.name).toBe("reverse_text");
    expect(registry.get("summarize_text")?.name).toBe("summarize_text");
    expect(registry.get("missing_tool")).toBeNull();
    expect(registry.list().map((tool) => tool.name)).toEqual(["reverse_text", "summarize_text"]);
  });

  it("rejects duplicate names", () => {
    const duplicateTool: ToolDefinition = {
      ...reverseTextTool,
      description: "Different config, same name."
    };

    expect(() => new ToolRegistry([reverseTextTool, duplicateTool])).toThrow(
      "Tool reverse_text is already registered."
    );
  });
});
