import { buildApp } from "./entrypoints/http/server.js";
import { createAppRuntime } from "./entrypoints/bootstrap/runtime.js";
import { env } from "./config/env.js";
import { ensureDatabaseSchemaReady } from "./db/client.js";
import { logDiagnostics } from "./utils/diagnostics.js";
import { trace, traceError } from "./utils/trace.js";

async function start() {
  trace("startup", "boot sequence start");
  const runtime = createAppRuntime();
  const daemon = runtime?.daemon ?? null;
  const execution = runtime?.execution ?? null;
  const adapters = runtime?.adapters ?? [];
  const agentRuntime = runtime?.agentRuntime ?? null;
  const app = buildApp({
    adapters,
    execution,
    agentRuntime
  });

  app.addHook("onClose", async () => {
    trace("startup", "shutdown start");
    await runtime?.closeAgentRuntime();
    await daemon?.stop();
    trace("startup", "shutdown complete");
  });

  if (runtime !== null) {
    try {
      await ensureDatabaseSchemaReady(
        adapters.flatMap((adapter) => adapter.getDatabaseRequirements?.() ?? [])
      );
      trace("startup", "database schema ready");
    } catch (error) {
      traceError("startup", "database schema check failed", error);
      app.log.error(error, "Database schema is not initialized. Run `pnpm db:migrate`.");
      process.exit(1);
    }
  }

  daemon?.start();

  if (runtime !== null) {
    try {
      const initResult = await runtime.initializeAgentRuntime();
      logDiagnostics(app.log, initResult?.diagnostics ?? []);
      trace("startup", "agent runtime initialized");
    } catch (error) {
      traceError("startup", "agent runtime initialization failed", error);
      app.log.error(error, "Failed to initialize agent runtime on startup.");
      process.exit(1);
    }
  }

  try {
    await app.listen({
      host: env.HOST,
      port: env.PORT
    });
  } catch (error) {
    traceError("startup", "http listen failed", error);
    app.log.error(error);
    process.exit(1);
  }
  trace("startup", "http server listening", {
    host: env.HOST,
    port: env.PORT
  });

  if (runtime !== null) {
    try {
      await runtime.initializeAdapters({
        logger: app.log,
        execution
      });
      trace("startup", "adapters initialized", {
        count: adapters.length,
        adapters: adapters.map((adapter) => adapter.name)
      });
    } catch (error) {
      traceError("startup", "adapter initialization failed", error);
      app.log.error(error, "Failed to initialize adapters on startup.");
      await app.close();
      process.exit(1);
    }
  }

  if (runtime !== null && (env.RECOVERY_ENABLED ?? true)) {
    void recoverActiveRunsInBackground(runtime.recoverActiveRuns, app);
  } else if (runtime !== null) {
    trace("startup", "active run recovery disabled");
  }
}

void start();

async function recoverActiveRunsInBackground(
  recoverActiveRuns: () => Promise<unknown[]>,
  app: { log: { error: (error: unknown, message: string) => void } }
): Promise<void> {
  try {
    const recovered = await recoverActiveRuns();
    trace("startup", "active runs recovered", {
      count: recovered.length
    });
  } catch (error) {
    traceError("startup", "active run recovery failed", error);
    app.log.error(error, "Failed to recover active runs on startup.");
  }
}
