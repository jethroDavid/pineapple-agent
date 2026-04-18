import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { jsonObjectSchema, type JsonObject } from "../../shared/types/json.js";

const functionResultOutputItemWithCodexProviderDataSchema = z.object({
  providerData: z.object({
    codex: jsonObjectSchema
  })
});

type CodexCallToolResult = z.infer<typeof CallToolResultSchema>;

export function toCodexAgentToolOutput(result: CodexCallToolResult): {
  type: "text";
  text: string;
  providerData?: {
    codex: JsonObject;
  };
} {
  const codexProviderData = asJsonObject(result.structuredContent);

  return {
    type: "text",
    text: getCodexToolOutputText(result, codexProviderData),
    ...(codexProviderData ? { providerData: { codex: codexProviderData } } : {})
  };
}

export function extractCodexProviderDataFromFunctionResultOutput(output: unknown): JsonObject | null {
  if (!Array.isArray(output)) {
    return null;
  }

  for (const item of output) {
    const parsed = functionResultOutputItemWithCodexProviderDataSchema.safeParse(item);

    if (parsed.success) {
      return parsed.data.providerData.codex;
    }
  }

  return null;
}

function getCodexToolOutputText(
  result: CodexCallToolResult,
  structuredContent: JsonObject | null
): string {
  const structuredContentText = structuredContent?.content;

  if (typeof structuredContentText === "string") {
    return structuredContentText;
  }

  const textContentItem = result.content.find((item) => item.type === "text");

  if (textContentItem) {
    return textContentItem.text;
  }

  return JSON.stringify(result.content);
}

function asJsonObject(value: unknown): JsonObject | null {
  const parsed = jsonObjectSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
