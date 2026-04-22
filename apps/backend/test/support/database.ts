import { randomUUID } from "node:crypto";

import { closeDb } from "../../src/db/client.js";
import { env } from "../../src/config/env.js";

import pg from "pg";

const pool = new pg.Pool({
  connectionString: env.DATABASE_URL
});

export async function cleanupRecords(ids: {
  threadIds?: string[];
}) {
  if (ids.threadIds?.length) {
    await pool.query(
      "delete from agent_execution_decisions where thread_id = any($1::uuid[])",
      [ids.threadIds]
    );
    await pool.query("delete from agent_executions where thread_id = any($1::uuid[])", [
      ids.threadIds
    ]);
    await pool.query("delete from specialist_sessions where thread_id = any($1::uuid[])", [
      ids.threadIds
    ]);
    await pool.query("delete from agent_threads where thread_id = any($1::uuid[])", [ids.threadIds]);
    await pool.query("delete from threads where thread_id = any($1::uuid[])", [ids.threadIds]);
  }
}

export async function closeTestDatabase() {
  await closeDb();
  await pool.end();
}

export async function insertRawThread(overrides?: {
  threadId?: string;
  subjectType?: string | null;
  subjectId?: string | null;
}) {
  const threadId = overrides?.threadId ?? randomUUID();

  await pool.query(
    `
      insert into threads (
        thread_id,
        subject_type,
        subject_id,
        last_response_id,
        closed_at,
        created_at,
        updated_at
      ) values ($1, $2, $3, null, null, now(), now())
    `,
    [threadId, overrides?.subjectType ?? null, overrides?.subjectId ?? null]
  );

  return threadId;
}
