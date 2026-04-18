import type { FastifyBaseLogger, FastifyInstance } from "fastify";

import type { ToolDefinition } from "../tools/tool-definition.js";
import type { AppExecutionService } from "../execution/pipeline/service.js";

export interface AppAdapterRouteContext {
  execution: AppExecutionService | null;
}

export interface AppAdapterInitContext {
  logger: FastifyBaseLogger;
  execution: AppExecutionService | null;
}

export interface AppAdapter {
  readonly name: string;
  getTools(): ToolDefinition[];
  registerRoutes(app: FastifyInstance, context: AppAdapterRouteContext): void;
  initialize?(context: AppAdapterInitContext): Promise<void>;
}
