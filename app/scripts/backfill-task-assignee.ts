import { createClient } from '@libsql/client';

const SQLITE_URI = process.env.SQLITE_URI;
const SQLITE_AUTH_TOKEN = process.env.SQLITE_AUTH_TOKEN;
const SQLITE_PATH = process.env.SQLITE_PATH;

if (!SQLITE_URI && !SQLITE_PATH) {
  console.error('Missing SQLITE_URI or SQLITE_PATH env var');
  process.exit(1);
}

const client = SQLITE_PATH
  ? createClient({ url: `file:${SQLITE_PATH}` })
  : createClient({ url: SQLITE_URI!, authToken: SQLITE_AUTH_TOKEN });

async function main() {
  // Count eligible source rows
  const countResult = await client.execute(
    `SELECT COUNT(*) as cnt FROM task WHERE assigned_to_user_id IS NOT NULL`
  );
  const total = Number((countResult.rows[0] as any).cnt);
  console.log(`Tasks with assigned_to_user_id: ${total}`);

  // Idempotent INSERT — skips rows already in task_assignee
  const result = await client.execute(`
    INSERT INTO task_assignee (task_id, user_id, tenant_id, role, created_at)
    SELECT id, assigned_to_user_id, tenant_id, NULL,
           CAST(strftime('%s', created_at) AS INTEGER)
    FROM task
    WHERE assigned_to_user_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM task_assignee
        WHERE task_assignee.task_id = task.id
          AND task_assignee.user_id = task.assigned_to_user_id
      )
  `);

  console.log(`Inserted: ${result.rowsAffected} rows`);

  // Verify
  const verifyResult = await client.execute(
    `SELECT COUNT(*) as cnt FROM task_assignee`
  );
  const assigneeCount = Number((verifyResult.rows[0] as any).cnt);
  console.log(`task_assignee total rows: ${assigneeCount}`);

  if (assigneeCount < total) {
    console.warn(`WARNING: task_assignee (${assigneeCount}) < source tasks (${total}). Some rows may have had null created_at or other issues.`);
  } else {
    console.log('✅ Backfill complete — counts match');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
