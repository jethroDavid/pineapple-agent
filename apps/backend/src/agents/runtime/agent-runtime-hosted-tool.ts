import { webSearchTool, type Tool } from "@openai/agents";

import type { AgentRuntimeContext } from "../agent-runtime-context.js";
import type { HostedToolManifest } from "../agent-manifest.js";

export function toHostedTools(
  hostedTools: HostedToolManifest[] | undefined
): Tool<AgentRuntimeContext>[] {
  if (!hostedTools || hostedTools.length === 0) {
    return [];
  }

  return hostedTools.map((hostedTool) => {
    switch (hostedTool.type) {
      case "web_search":
        return webSearchTool({
          searchContextSize: hostedTool.searchContextSize,
          externalWebAccess: hostedTool.externalWebAccess,
          filters: hostedTool.allowedDomains
            ? {
                allowedDomains: hostedTool.allowedDomains
              }
            : undefined
        });
    }
  });
}
