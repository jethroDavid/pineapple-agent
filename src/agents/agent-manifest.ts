import { z } from "zod";

const nonEmptyString = z.string().trim().min(1);

const agentModelPresetSchema = z.enum(["app", "codex"]);

const stdioMcpServerManifestSchema = z.object({
  id: nonEmptyString,
  transport: z.literal("stdio").default("stdio"),
  command: nonEmptyString,
  args: z.array(z.string()).default([]),
  cwd: nonEmptyString.optional(),
  env: z.record(z.string(), z.string()).default({})
});

const codexMcpSessionBackendManifestSchema = z.object({
  kind: z.literal("codex_mcp"),
  serverId: nonEmptyString,
  startToolName: nonEmptyString.default("codex"),
  replyToolName: nonEmptyString.default("codex-reply")
});

const sessionBackendManifestSchema = z.discriminatedUnion("kind", [
  codexMcpSessionBackendManifestSchema
]);

export const agentManifestSchema = z.object({
  id: nonEmptyString,
  name: nonEmptyString,
  description: z.string().trim().optional(),
  handoffDescription: nonEmptyString,
  instructionsFile: nonEmptyString,
  model: nonEmptyString.optional(),
  modelPreset: agentModelPresetSchema.optional(),
  handoffs: z.array(nonEmptyString).default([]),
  toolsets: z.array(nonEmptyString).default([]),
  mcpServers: z.array(stdioMcpServerManifestSchema).default([]),
  sessionBackend: sessionBackendManifestSchema.optional(),
  entrypoint: z.boolean().default(false)
});

type AgentManifest = z.infer<typeof agentManifestSchema>;
export type StdioMcpServerManifest = z.infer<typeof stdioMcpServerManifestSchema>;
export type SessionBackendManifest = z.infer<typeof sessionBackendManifestSchema>;
export type CodexMcpSessionBackendManifest = z.infer<
  typeof codexMcpSessionBackendManifestSchema
>;

export interface LoadedAgentManifest extends AgentManifest {
  manifestPath: string;
  instructionsPath: string;
  instructions: string;
}
