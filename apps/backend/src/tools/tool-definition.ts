import { z } from "zod";

import type { JsonObject, JsonValue } from "../shared/types/json.js";

export interface ToolExecutionContext {
  threadId?: string;
}

export interface ToolTurnPolicy<Input extends JsonObject = JsonObject> {
  recordMarker?: string;
  blockedByMarkers?: {
    markers: string[];
    message: string;
  };
  onlyOncePerTurn?: {
    marker: string;
    createDuplicateOutput(input: Input): JsonValue;
  };
}

export interface ToolDefinition<
  Input extends JsonObject = JsonObject,
  Output extends JsonValue = JsonValue
> {
  name: string;
  description?: string;
  inputSchema: z.ZodType<Input>;
  outputSchema: z.ZodType<Output>;
  sideEffecting: boolean;
  approvalRequired: boolean;
  idempotent: boolean;
  turnPolicy?: ToolTurnPolicy<Input>;
  execute(input: Input, context?: ToolExecutionContext): Promise<Output>;
}
