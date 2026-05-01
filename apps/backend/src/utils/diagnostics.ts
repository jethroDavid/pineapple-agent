import type { FastifyBaseLogger } from "fastify";

export interface AppDiagnostic {
  level: "info" | "warn" | "error";
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export function logDiagnostics(
  logger: FastifyBaseLogger,
  diagnostics: AppDiagnostic[]
): void {
  for (const diagnostic of diagnostics) {
    logger[diagnostic.level](
      {
        code: diagnostic.code,
        ...(diagnostic.details ?? {})
      },
      diagnostic.message
    );
  }
}
