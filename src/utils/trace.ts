import { env } from "../config/env.js";

const traceEnabled =
  env.TRACE_CONSOLE ?? env.NODE_ENV === "development";

export function trace(
  scope: string,
  message: string,
  details?: unknown
): void {
  if (!traceEnabled) {
    return;
  }

  if (details === undefined) {
    console.log(`[${scope}] ${message}`);
    return;
  }

  console.log(`[${scope}] ${message}`, safeStringify(details));
}

export function traceError(
  scope: string,
  message: string,
  error: unknown,
  details?: unknown
): void {
  if (!traceEnabled) {
    return;
  }

  const payload = {
    ...(details === undefined ? {} : { details }),
    error: toErrorPayload(error)
  };

  console.error(`[${scope}] ${message}`, safeStringify(payload));
}

function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>();

  try {
    return JSON.stringify(
      value,
      (_key, current) => {
        if (current instanceof Date) {
          return current.toISOString();
        }

        if (current instanceof Error) {
          return toErrorPayload(current);
        }

        if (typeof current === "object" && current !== null) {
          if (seen.has(current)) {
            return "[Circular]";
          }

          seen.add(current);
        }

        return current;
      }
    );
  } catch {
    return String(value);
  }
}

function toErrorPayload(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack
    };
  }

  return {
    value: error
  };
}
