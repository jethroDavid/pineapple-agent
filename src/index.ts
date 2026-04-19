import { buildApp } from "./entrypoints/http/server.js";
import { createAppRuntime } from "./entrypoints/bootstrap/runtime.js";
import { env } from "./config/env.js";
import { ensureDatabaseSchemaReady } from "./db/client.js";

async function start() {
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
    await runtime?.closeAgentRuntime();
    await daemon?.stop();
  });

  if (runtime !== null) {
    try {
      await ensureDatabaseSchemaReady();
    } catch (error) {
      app.log.error(error, "Database schema is not initialized. Run `pnpm db:migrate`.");
      process.exit(1);
    }
  }

  daemon?.start();

  if (runtime !== null) {
    try {
      await runtime.initializeAgentRuntime();
    } catch (error) {
      app.log.error(error, "Failed to initialize agent runtime on startup.");
      process.exit(1);
    }
  }

  if (runtime !== null) {
    try {
      await runtime.recoverActiveRuns();
    } catch (error) {
      app.log.error(error, "Failed to recover active runs on startup.");
    }
  }

  try {
    await app.listen({
      host: env.HOST,
      port: env.PORT
    });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }

  if (runtime !== null) {
    try {
      await runtime.initializeAdapters({
        logger: app.log,
        execution
      });
    } catch (error) {
      app.log.error(error, "Failed to initialize adapters on startup.");
      await app.close();
      process.exit(1);
    }
  }
}

void start();
