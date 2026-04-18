import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

import { env } from "../config/env.js";
import * as schema from "./schema.js";

let database: ReturnType<typeof drizzle<typeof schema>> | null = null;
let pool: pg.Pool | null = null;

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

export async function closeDb(): Promise<void> {
  database = null;

  if (!pool) {
    return;
  }

  await pool.end();
  pool = null;
}
