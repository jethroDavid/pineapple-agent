import { tool, type Tool } from "@openai/agents";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type {
  CodexMcpSessionBackendManifest,
  LoadedAgentManifest,
  StdioMcpServerManifest
} from "../agent-manifest.js";
import type { AgentRuntimeContext } from "../agent-runtime-context.js";
import type { SpecialistSession } from "../domain/specialist-session.js";
import type { UpsertSpecialistSessionInput } from "../store/specialist-session-store.js";
import type { SessionBackend } from "../session-backends/session-backend.js";
import { interpolateEnvVariables } from "../interpolate-env-variables.js";

import {
  extractCodexProviderDataFromFunctionResultOutput,
  toCodexAgentToolOutput
} from "./codex-mcp-provider-codec.js";

const DEFAULT_REQUEST_TIMEOUT_MS = 60000;

interface CodexMcpProviderOptions {
  manifest: LoadedAgentManifest;
  server: StdioMcpServerManifest;
  sessionBackend: CodexMcpSessionBackendManifest;
}

interface CodexToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const functionCallResultOutputItemSchema = z.object({
  type: z.literal("function_call_result"),
  name: z.string(),
  output: z.unknown()
});

export class CodexMcpProvider implements SessionBackend {
  readonly kind = "codex_mcp";

  #client: Client | null = null;
  #transport: StdioClientTransport | null = null;
  #toolDefinitions: CodexToolDefinition[] = [];

  constructor(private readonly options: CodexMcpProviderOptions) {}

  async initialize() {
    this.#transport = new StdioClientTransport({
      command: this.options.server.command,
      args: this.options.server.args,
      env: interpolateEnvVariables(this.options.server.env),
      cwd: this.options.server.cwd
    });
    this.#client = new Client({
      name: `${this.options.manifest.id}:codex-mcp`,
      version: "1.0.0"
    });

    await this.#client.connect(this.#transport);

    const listed = await this.#client.listTools();
    this.#toolDefinitions = listed.tools
      .filter(
        (toolDefinition) =>
          toolDefinition.name === this.options.sessionBackend.startToolName ||
          toolDefinition.name === this.options.sessionBackend.replyToolName
      )
      .map((toolDefinition) => ({
        name: toolDefinition.name,
        description: toolDefinition.description ?? "",
        inputSchema: {
          ...toolDefinition.inputSchema,
          type: toolDefinition.inputSchema?.type ?? "object",
          properties: toolDefinition.inputSchema?.properties ?? {},
          required: toolDefinition.inputSchema?.required ?? [],
          additionalProperties: true
        }
      }));

    if (this.#toolDefinitions.length !== 2) {
      throw new Error(
        `Codex MCP provider expected tools ${this.options.sessionBackend.startToolName} and ${this.options.sessionBackend.replyToolName}.`
      );
    }
  }

  async close() {
    await this.#transport?.close();
    await this.#client?.close();
    this.#transport = null;
    this.#client = null;
    this.#toolDefinitions = [];
  }

  createTools(): Tool<AgentRuntimeContext>[] {
    return this.#toolDefinitions.map((toolDefinition) =>
      tool({
        name: toolDefinition.name,
        description: toolDefinition.description,
        parameters: toolDefinition.inputSchema as never,
        strict: false,
        execute: async (input) => {
          const result = await this.callTool(toolDefinition.name, input as Record<string, unknown>);
          return toCodexAgentToolOutput(result);
        }
      })
    );
  }

  buildInstructions(session: SpecialistSession | null): string | null {
    if (session?.providerThreadId) {
      return [
        "Codex session continuity:",
        `- There is an existing Codex MCP thread for this app thread: ${session.providerThreadId}.`,
        `- Continue that session with \`${this.options.sessionBackend.replyToolName}\` unless you intentionally need to branch.`,
        `- Use \`${this.options.sessionBackend.startToolName}\` only when you explicitly need a fresh Codex thread.`
      ].join("\n");
    }

    return [
      "Codex session continuity:",
      "- This thread does not have a persisted Codex MCP thread yet.",
      `- Start one with \`${this.options.sessionBackend.startToolName}\`.`,
      `- After that, continue the same Codex thread with \`${this.options.sessionBackend.replyToolName}\`.`
    ].join("\n");
  }

  extractSessionUpdate(
    outputItems: unknown[]
  ): Omit<UpsertSpecialistSessionInput, "threadId"> | null {
    for (const outputItem of outputItems) {
      const parsedOutputItem = functionCallResultOutputItemSchema.safeParse(outputItem);

      if (!parsedOutputItem.success) {
        continue;
      }

      const item = parsedOutputItem.data;

      if (
        item.name !== this.options.sessionBackend.startToolName &&
        item.name !== this.options.sessionBackend.replyToolName
      ) {
        continue;
      }

      const providerData = extractCodexProviderDataFromFunctionResultOutput(item.output);
      const threadId = typeof providerData?.threadId === "string" ? providerData.threadId : null;

      if (!threadId) {
        continue;
      }

      return {
        agentId: this.options.manifest.id,
        provider: this.kind,
        providerThreadId: threadId,
        ...(providerData ? { state: providerData } : {})
      };
    }

    return null;
  }

  private async callTool(name: string, input: Record<string, unknown>) {
    if (!this.#client) {
      throw new Error(`Codex MCP provider for ${this.options.manifest.id} is not initialized.`);
    }

    const response = await this.#client.callTool(
      {
        name,
        arguments: input
      },
      undefined,
      {
        timeout: DEFAULT_REQUEST_TIMEOUT_MS
      }
    );

    return CallToolResultSchema.parse(response);
  }
}
