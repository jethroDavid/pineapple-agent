import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import pg from "pg";

import { env } from "../config/env.js";
import * as schema from "./schema.js";

let database: ReturnType<typeof drizzle<typeof schema>> | null = null;
let pool: pg.Pool | null = null;

export class DatabaseSchemaNotInitializedError extends Error {
  constructor(missingRelations: string[] = [], options?: ErrorOptions) {
    super(
      [
        "Database schema is not initialized. Run `pnpm db:migrate` before starting Pineapple.",
        missingRelations.length > 0
          ? `Missing relation(s): ${missingRelations.join(", ")}.`
          : null
      ]
        .filter(Boolean)
        .join(" "),
      options
    );
    this.name = "DatabaseSchemaNotInitializedError";
  }
}

export interface DatabaseRelationRequirement {
  schema?: string;
  relation: string;
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

export async function ensureDatabaseSchemaReady(
  requirements: DatabaseRelationRequirement[] = []
): Promise<void> {
  const db = getDb();
  const missingRelations: string[] = [];
  const allRequirements = dedupeRelationRequirements([
    {
      relation: "threads"
    },
    ...requirements
  ]);

  for (const requirement of allRequirements) {
    const relationName = formatRelationName(requirement);
    const result = await db.execute<{ relation: string | null }>(
      sql`select to_regclass(${relationName}) as relation`
    );
    const relation = result.rows[0]?.relation ?? null;

    if (relation === null) {
      missingRelations.push(relationName);
    }
  }

  if (missingRelations.length > 0) {
    throw new DatabaseSchemaNotInitializedError(missingRelations);
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

function dedupeRelationRequirements(
  requirements: DatabaseRelationRequirement[]
): DatabaseRelationRequirement[] {
  const seen = new Set<string>();
  const deduped: DatabaseRelationRequirement[] = [];

  for (const requirement of requirements) {
    const relationName = formatRelationName(requirement);
    if (seen.has(relationName)) {
      continue;
    }

    seen.add(relationName);
    deduped.push(requirement);
  }

  return deduped;
}

function formatRelationName(requirement: DatabaseRelationRequirement): string {
  return requirement.schema
    ? `${requirement.schema}.${requirement.relation}`
    : requirement.relation;
}
