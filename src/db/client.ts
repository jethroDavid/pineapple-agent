import { drizzle } from "drizzle-orm/node-postgres";
import { DrizzleQueryError } from "drizzle-orm/errors";
import pg from "pg";

import { env } from "../config/env.js";
import * as schema from "./schema.js";

let database: ReturnType<typeof drizzle<typeof schema>> | null = null;
let pool: pg.Pool | null = null;

export class DatabaseSchemaNotInitializedError extends Error {
  constructor(options?: ErrorOptions) {
    super(
      "Database schema is not initialized. Run `pnpm db:migrate` before starting Pineapple.",
      options
    );
    this.name = "DatabaseSchemaNotInitializedError";
  }
}

export function getDb() {
  if (database) {
    return database;
  }

  if (!env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not configured.");
  }

  pool = new pg.Pool({
    connectionString: env.DATABASE_URL
  });

  database = drizzle(pool, { schema });
  return database;
}

export async function ensureDatabaseSchemaReady(): Promise<void> {
  const db = getDb();

  try {
    await db
      .select({
        threadId: schema.threads.threadId
      })
      .from(schema.threads)
      .limit(1);
  } catch (error) {
    if (isMissingRelationError(error)) {
      throw new DatabaseSchemaNotInitializedError({
        cause: error
      });
    }

    throw error;
  }
}

export async function closeDb(): Promise<void> {
  database = null;

  if (!pool) {
    return;
  }

  await pool.end();
  pool = null;
}

function isMissingRelationError(error: unknown): boolean {
  if (!(error instanceof DrizzleQueryError)) {
    return false;
  }

  const cause = error.cause as
    | {
        code?: string;
      }
    | undefined;

  return cause?.code === "42P01";
}
