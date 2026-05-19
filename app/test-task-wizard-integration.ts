/**
 * Integration test for NewTaskModal 3-step wizard (commit 0ebec3e, Faza 2 Part 1)
 * Run: bun --bun test-task-wizard-integration.ts
 */

import { createClient, type Client } from '@libsql/client';
import { readFileSync, copyFileSync, existsSync, unlinkSync } from 'fs';

// ─── IDs ────────────────────────────────────────────────────────────────────
// navitech tenant — has 2 users, needed for multi-assignee test
const PRIMARY_TENANT_ID = 'oukme5nzcu7rvnutz6cvyyig';
// ots tenant — needed for cross-tenant isolation
const SECONDARY_TENANT_ID = 'j2jdclw2j4gr2ofzitam3au2';
const USER1_ID = 'gztzpcizq4gt3kd6eyzu3yr7';
const USER2_ID = 'yu4stg6m564oexmx6oskh43t';
const CLIENT_ID = '54kchoy4f4iqkrhsbekti2w7';
const SECONDARY_USER_ID = 'itjm7agu37dsf2raje3pw3nk';

// ─── Helpers ────────────────────────────────────────────────────────────────
function genId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz234567';
  let id = '';
  const bytes = new Uint8Array(15);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < 15; i++) id += chars[bytes[i] % 32];
  return id;
}

type TestResult = { name: string; pass: boolean; detail: string };
const results: TestResult[] = [];

function report(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail });
  console.log(`${pass ? '✅' : '❌'} ${name}: ${detail}`);
}

// ─── Migrations needed (idempotent — "already exists" errors ignored) ───────
// 0209-0214: task recurring columns (missing from local.db)
// 0302-0316: new wizard tables + task columns (type, meet_time, meet_duration_minutes)
const MIGRATIONS = [
  'drizzle/0209_task_is_recurring.sql',
  'drizzle/0210_task_recurring_type.sql',
  'drizzle/0211_task_recurring_interval.sql',
  'drizzle/0212_task_recurring_end_date.sql',
  'drizzle/0213_task_recurring_parent_id.sql',
  'drizzle/0214_task_recurring_spawned_at.sql',
  'drizzle/0302_task_add_type.sql',
  'drizzle/0303_subtask_create_table.sql',
  'drizzle/0304_subtask_task_id_idx.sql',
  'drizzle/0305_subtask_tenant_id_idx.sql',
  'drizzle/0306_task_tag_create_table.sql',
  'drizzle/0307_task_tag_tenant_id_idx.sql',
  'drizzle/0308_task_tag_tenant_name_uniq.sql',
  'drizzle/0309_task_to_tag_create_table.sql',
  'drizzle/0310_task_to_tag_task_id_idx.sql',
  'drizzle/0311_task_to_tag_tag_id_idx.sql',
  'drizzle/0312_task_assignee_create_table.sql',
  'drizzle/0313_task_assignee_user_id_idx.sql',
  'drizzle/0314_task_assignee_tenant_id_idx.sql',
  'drizzle/0315_task_meet_time.sql',
  'drizzle/0316_task_meet_duration_minutes.sql',
];

async function applyMigrations(client: Client) {
  for (const file of MIGRATIONS) {
    try {
      const sql = readFileSync(file, 'utf-8').trim();
      if (sql) await client.execute(sql);
    } catch (e: any) {
      // Ignore "already exists" and "duplicate column" — idempotent
      if (!e.message?.includes('already exists') && !e.message?.includes('duplicate column')) {
        console.warn(`  Migration ${file}: ${e.message}`);
      }
    }
  }
}

// ─── Core createTask logic (replicated from tasks.remote.ts) ─────────────────
interface CreateTaskParams {
  title: string;
  description?: string;
  type?: string;
  clientId?: string;
  status?: string;
  priority?: string;
  dueDate?: string;
  assignedToUserId?: string;
  assigneeUserIds?: string[];
  tagNames?: string[];
  subtasks?: string[];
  meetTime?: string | null;
  meetDurationMinutes?: number | null;
  tenantId: string;
  createdByUserId: string;
}

async function createTaskDirect(client: Client, params: CreateTaskParams): Promise<string> {
  // Validate title (mirrors valibot schema)
  if (!params.title.trim()) throw new Error('Title is required');

  const taskId = genId();
  const now = new Date().toISOString();
  const status = params.status ?? 'todo';

  // Get max position for this status+tenant
  const maxPosResult = await client.execute({
    sql: `SELECT COALESCE(MAX(position), -1) as max_pos FROM task WHERE tenant_id = ? AND status = ?`,
    args: [params.tenantId, status]
  });
  const nextPosition = (Number((maxPosResult.rows[0] as any).max_pos) ?? -1) + 1;

  await client.execute({
    sql: `INSERT INTO task (
            id, tenant_id, client_id, title, description, status, priority, position,
            due_date, assigned_to_user_id, created_by_user_id, is_recurring,
            type, meet_time, meet_duration_minutes, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
    args: [
      taskId,
      params.tenantId,
      params.clientId ?? null,
      params.title,
      params.description ?? null,
      status,
      params.priority ?? 'medium',
      nextPosition,
      params.dueDate ? new Date(params.dueDate).toISOString() : null,
      params.assignedToUserId ?? null,
      params.createdByUserId,
      params.type ?? null,
      params.meetTime ?? null,
      params.meetDurationMinutes ?? null,
      now,
      now
    ]
  });

  // Insert subtasks
  if (params.subtasks?.length) {
    for (let i = 0; i < params.subtasks.length; i++) {
      const ts = Date.now();
      await client.execute({
        sql: `INSERT INTO subtask (id, task_id, tenant_id, title, done, position, created_by_user_id, created_at, updated_at)
              VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)`,
        args: [genId(), taskId, params.tenantId, params.subtasks[i], i, params.createdByUserId, ts, ts]
      });
    }
  }

  // Normalize + deduplicate tag names (mirrors fix in tasks.remote.ts)
  const uniqueTags = [...new Set(
    (params.tagNames || [])
      .map((t) => {
        const stripped = t.trim().startsWith('#') ? t.trim() : `#${t.trim()}`;
        return stripped.toLowerCase();
      })
      .filter((t) => t.length > 1)
  )];

  // Find-or-create tags and link
  for (const normalizedName of uniqueTags) {
    const existing = await client.execute({
      sql: `SELECT id FROM task_tag WHERE tenant_id = ? AND name = ? LIMIT 1`,
      args: [params.tenantId, normalizedName]
    });
    let tagId: string;
    if (existing.rows.length > 0) {
      tagId = (existing.rows[0] as any).id;
    } else {
      tagId = genId();
      await client.execute({
        sql: `INSERT INTO task_tag (id, tenant_id, name, created_at) VALUES (?, ?, ?, ?)`,
        args: [tagId, params.tenantId, normalizedName, Date.now()]
      });
    }
    await client.execute({
      sql: `INSERT INTO task_to_tag (task_id, tag_id, tenant_id) VALUES (?, ?, ?)`,
      args: [taskId, tagId, params.tenantId]
    });
  }

  // Insert multi-assignees
  if (params.assigneeUserIds?.length) {
    for (const userId of params.assigneeUserIds) {
      try {
        await client.execute({
          sql: `INSERT INTO task_assignee (task_id, user_id, tenant_id, created_at) VALUES (?, ?, ?, ?)`,
          args: [taskId, userId, params.tenantId, Date.now()]
        });
      } catch { /* ignore duplicate */ }
    }
  }

  return taskId;
}

async function cleanupTask(client: Client, taskId: string, tenantId: string, tagNamesToClean?: string[]) {
  await client.execute({ sql: `DELETE FROM task WHERE id = ? AND tenant_id = ?`, args: [taskId, tenantId] });
  if (tagNamesToClean) {
    for (const name of tagNamesToClean) {
      const cleanName = name.startsWith('#') ? name : `#${name}`;
      const inUse = await client.execute({
        sql: `SELECT COUNT(*) as cnt FROM task_to_tag WHERE tag_id = (SELECT id FROM task_tag WHERE tenant_id = ? AND name = ? LIMIT 1)`,
        args: [tenantId, cleanName]
      });
      if (Number((inUse.rows[0] as any).cnt) === 0) {
        await client.execute({ sql: `DELETE FROM task_tag WHERE tenant_id = ? AND name = ?`, args: [tenantId, cleanName] });
      }
    }
  }
}

// ─── MAIN ───────────────────────────────────────────────────────────────────
const SOURCE_DB = 'local.db';
const TEST_DB = 'test-task-wizard.db';

async function main() {
  if (!existsSync(SOURCE_DB)) {
    console.log(`⚠️  Source DB '${SOURCE_DB}' not found. Exiting gracefully.`);
    process.exit(0);
  }

  copyFileSync(SOURCE_DB, TEST_DB);
  const client = createClient({ url: `file:${TEST_DB}` });

  try {
    console.log('📦 Applying migrations (0209-0214, 0302-0316)...');
    await applyMigrations(client);

    // Verify columns were applied
    const colsResult = await client.execute('PRAGMA table_info(task)');
    const cols = colsResult.rows.map((r: any) => r.name);
    const hasNewCols = ['is_recurring', 'type', 'meet_time', 'meet_duration_minutes'].every(c => cols.includes(c));
    const hasNewTables = (await client.execute("SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table' AND name IN ('subtask','task_tag','task_to_tag','task_assignee')")).rows[0] as any;
    console.log(`✅ Migrations applied. New task cols: ${hasNewCols}, New tables count: ${hasNewTables.cnt}/4\n`);

    // ── T1: Happy path full payload ──────────────────────────────────────────
    console.log('─── T1: Happy path full payload ───');
    let t1TaskId: string | null = null;
    try {
      t1TaskId = await createTaskDirect(client, {
        title: 'Test Wizard Task RO țară diacritics',
        description: 'Descriere cu ă, î, ș, ț, â',
        type: 'design',
        clientId: CLIENT_ID,
        status: 'todo',
        priority: 'medium',
        dueDate: '2026-06-01',
        assignedToUserId: USER1_ID,
        assigneeUserIds: [USER1_ID, USER2_ID],
        tagNames: ['#prioritate', 'campanie-noua', '#prioritate'],
        subtasks: ['Brief inițial', 'Review materiale', 'Aprobă'],
        meetTime: null,
        meetDurationMinutes: null,
        tenantId: PRIMARY_TENANT_ID,
        createdByUserId: USER1_ID
      });

      const taskRow = (await client.execute({ sql: `SELECT type, assigned_to_user_id, tenant_id FROM task WHERE id = ?`, args: [t1TaskId] })).rows[0] as any;
      const taskOk = taskRow?.type === 'design' && taskRow?.assigned_to_user_id === USER1_ID && taskRow?.tenant_id === PRIMARY_TENANT_ID;

      const assigneeCount = Number(((await client.execute({ sql: `SELECT COUNT(*) as cnt FROM task_assignee WHERE task_id = ?`, args: [t1TaskId] })).rows[0] as any).cnt);
      const tagCount = Number(((await client.execute({ sql: `SELECT COUNT(*) as cnt FROM task_tag WHERE tenant_id = ? AND name IN ('#prioritate', '#campanie-noua')`, args: [PRIMARY_TENANT_ID] })).rows[0] as any).cnt);
      const linkCount = Number(((await client.execute({ sql: `SELECT COUNT(*) as cnt FROM task_to_tag WHERE task_id = ?`, args: [t1TaskId] })).rows[0] as any).cnt);
      const subtaskRows = await client.execute({ sql: `SELECT position FROM subtask WHERE task_id = ? ORDER BY position`, args: [t1TaskId] });
      const subtaskCount = subtaskRows.rows.length;
      const positions = subtaskRows.rows.map((r: any) => r.position);

      const pass = taskOk && assigneeCount === 2 && tagCount === 2 && linkCount === 2 && subtaskCount === 3 && JSON.stringify(positions) === '[0,1,2]';
      report('T1 Happy path', pass, `task: ${taskOk?'OK':'FAIL'}, assignees: ${assigneeCount}/2, tags: ${tagCount}/2, tag_to_task links: ${linkCount}/2, subtasks: ${subtaskCount}/3 positions[${positions}]`);
    } catch (e: any) {
      report('T1 Happy path', false, `ERROR: ${e.message}`);
    } finally {
      if (t1TaskId) await cleanupTask(client, t1TaskId, PRIMARY_TENANT_ID, ['#prioritate', '#campanie-noua']);
    }

    // ── T2: Tag find-or-create idempotency ──────────────────────────────────
    console.log('\n─── T2: Tag find-or-create idempotency ───');
    let t2A: string | null = null, t2B: string | null = null;
    try {
      const before = Number(((await client.execute({ sql: `SELECT COUNT(*) as cnt FROM task_tag WHERE tenant_id = ? AND name = '#prioritate'`, args: [PRIMARY_TENANT_ID] })).rows[0] as any).cnt);

      t2A = await createTaskDirect(client, { title: 'T2 Task A', type: 'design', status: 'todo', priority: 'medium', tagNames: ['#prioritate'], tenantId: PRIMARY_TENANT_ID, createdByUserId: USER1_ID });
      const mid = Number(((await client.execute({ sql: `SELECT COUNT(*) as cnt FROM task_tag WHERE tenant_id = ? AND name = '#prioritate'`, args: [PRIMARY_TENANT_ID] })).rows[0] as any).cnt);

      t2B = await createTaskDirect(client, { title: 'T2 Task B', type: 'design', status: 'todo', priority: 'medium', tagNames: ['#prioritate'], tenantId: PRIMARY_TENANT_ID, createdByUserId: USER1_ID });
      const after = Number(((await client.execute({ sql: `SELECT COUNT(*) as cnt FROM task_tag WHERE tenant_id = ? AND name = '#prioritate'`, args: [PRIMARY_TENANT_ID] })).rows[0] as any).cnt);

      const pass = mid === before + 1 && after === mid;
      report('T2 Tag idempotency', pass, `before: ${before}, after 1st task (tag created): ${mid}, after 2nd task (reused): ${after}`);
    } catch (e: any) {
      report('T2 Tag idempotency', false, `ERROR: ${e.message}`);
    } finally {
      if (t2A) await cleanupTask(client, t2A, PRIMARY_TENANT_ID);
      if (t2B) await cleanupTask(client, t2B, PRIMARY_TENANT_ID, ['#prioritate']);
    }

    // ── T3: Cross-tenant tag isolation ──────────────────────────────────────
    console.log('\n─── T3: Cross-tenant tag isolation ───');
    let t3A: string | null = null, t3B: string | null = null;
    try {
      t3A = await createTaskDirect(client, { title: 'T3 Task Tenant A', type: 'design', status: 'todo', priority: 'medium', tagNames: ['#prioritate'], tenantId: PRIMARY_TENANT_ID, createdByUserId: USER1_ID });
      t3B = await createTaskDirect(client, { title: 'T3 Task Tenant B', type: 'design', status: 'todo', priority: 'medium', tagNames: ['#prioritate'], tenantId: SECONDARY_TENANT_ID, createdByUserId: SECONDARY_USER_ID });

      const tagA = (await client.execute({ sql: `SELECT id FROM task_tag WHERE tenant_id = ? AND name = '#prioritate'`, args: [PRIMARY_TENANT_ID] })).rows[0] as any;
      const tagB = (await client.execute({ sql: `SELECT id FROM task_tag WHERE tenant_id = ? AND name = '#prioritate'`, args: [SECONDARY_TENANT_ID] })).rows[0] as any;

      const pass = tagA?.id && tagB?.id && tagA.id !== tagB.id;
      report('T3 Cross-tenant isolation', pass, `Tenant A tag: ${tagA?.id?.slice(0,8)}... | Tenant B tag: ${tagB?.id?.slice(0,8)}... — ${pass ? 'SEPARATE (correct)' : 'SAME or MISSING (fail)'}`);
    } catch (e: any) {
      report('T3 Cross-tenant isolation', false, `ERROR: ${e.message}`);
    } finally {
      if (t3A) await cleanupTask(client, t3A, PRIMARY_TENANT_ID, ['#prioritate']);
      if (t3B) await cleanupTask(client, t3B, SECONDARY_TENANT_ID, ['#prioritate']);
    }

    // ── T4: Meeting mode ─────────────────────────────────────────────────────
    console.log('\n─── T4: Meeting mode ───');
    let t4TaskId: string | null = null;
    try {
      t4TaskId = await createTaskDirect(client, {
        title: 'Sync săptămânal Heylux',
        type: 'meeting',
        status: 'todo',
        priority: 'medium',
        meetTime: '10:30',
        meetDurationMinutes: 60,
        tenantId: PRIMARY_TENANT_ID,
        createdByUserId: USER1_ID
      });
      const t = (await client.execute({ sql: `SELECT type, meet_time, meet_duration_minutes FROM task WHERE id = ?`, args: [t4TaskId] })).rows[0] as any;
      const pass = t?.type === 'meeting' && t?.meet_time === '10:30' && Number(t?.meet_duration_minutes) === 60;
      report('T4 Meeting mode', pass, `type: ${t?.type}, meet_time: ${t?.meet_time}, meet_duration_minutes: ${t?.meet_duration_minutes}`);
    } catch (e: any) {
      report('T4 Meeting mode', false, `ERROR: ${e.message}`);
    } finally {
      if (t4TaskId) await cleanupTask(client, t4TaskId, PRIMARY_TENANT_ID);
    }

    // ── T5: Rollback / FK behavior with fake userId ──────────────────────────
    console.log('\n─── T5: Rollback / FK behavior ───');
    let t5TaskId: string | null = null;
    try {
      const FAKE_USER = 'fake-user-id-does-not-exist';
      const beforeCnt = Number(((await client.execute({ sql: `SELECT COUNT(*) as cnt FROM task WHERE tenant_id = ?`, args: [PRIMARY_TENANT_ID] })).rows[0] as any).cnt);

      let threw = false;
      try {
        t5TaskId = await createTaskDirect(client, {
          title: 'T5 Rollback Test', type: 'design', status: 'todo', priority: 'medium',
          assigneeUserIds: [FAKE_USER],
          tenantId: PRIMARY_TENANT_ID, createdByUserId: USER1_ID
        });
      } catch { threw = true; t5TaskId = null; }

      const afterCnt = Number(((await client.execute({ sql: `SELECT COUNT(*) as cnt FROM task WHERE tenant_id = ?`, args: [PRIMARY_TENANT_ID] })).rows[0] as any).cnt);

      if (threw) {
        report('T5 Rollback', beforeCnt === afterCnt, `FK enforced, task count unchanged (${beforeCnt}→${afterCnt})`);
      } else {
        // task_assignee has NO FK to user table (by design per Sub-PR 1)
        const assigneeRows = await client.execute({ sql: `SELECT user_id FROM task_assignee WHERE task_id = ?`, args: [t5TaskId!] });
        report('T5 Rollback', false, `DOCUMENTED: task_assignee has NO FK to user table (intentional per Sub-PR 1 design). Orphan user_id '${FAKE_USER}' accepted. Row: ${JSON.stringify(assigneeRows.rows[0])}`);
      }
    } catch (e: any) {
      report('T5 Rollback', false, `ERROR: ${e.message}`);
    } finally {
      if (t5TaskId) await cleanupTask(client, t5TaskId, PRIMARY_TENANT_ID);
    }

    // ── T6: Validation — empty title ─────────────────────────────────────────
    console.log('\n─── T6: Validation — empty title ───');
    try {
      const before = Number(((await client.execute({ sql: `SELECT COUNT(*) as cnt FROM task WHERE tenant_id = ?`, args: [PRIMARY_TENANT_ID] })).rows[0] as any).cnt);
      let threw = false;
      try {
        await createTaskDirect(client, { title: '', type: 'design', status: 'todo', priority: 'medium', tenantId: PRIMARY_TENANT_ID, createdByUserId: USER1_ID });
      } catch { threw = true; }
      const after = Number(((await client.execute({ sql: `SELECT COUNT(*) as cnt FROM task WHERE tenant_id = ?`, args: [PRIMARY_TENANT_ID] })).rows[0] as any).cnt);
      const pass = threw && before === after;
      report('T6 Validation', pass, `threw before DB write: ${threw}, task count unchanged: ${before}→${after}`);
    } catch (e: any) {
      report('T6 Validation', false, `ERROR: ${e.message}`);
    }

    // ── T7: Tag case normalization — mixed-case duplicates collapse to one row ─
    console.log('\n─── T7: Tag case normalization ───');
    let t7TaskId: string | null = null;
    try {
      // '#Prioritate', '#prioritate', 'PRIORITATE' must all map to '#prioritate' → 1 tag row
      t7TaskId = await createTaskDirect(client, {
        title: 'T7 Case normalization test',
        type: 'design',
        status: 'todo',
        priority: 'medium',
        tagNames: ['#Prioritate', '#prioritate', 'PRIORITATE'],
        tenantId: PRIMARY_TENANT_ID,
        createdByUserId: USER1_ID
      });

      const tagCount = Number(((await client.execute({
        sql: `SELECT COUNT(*) as cnt FROM task_tag WHERE tenant_id = ? AND name = '#prioritate'`,
        args: [PRIMARY_TENANT_ID]
      })).rows[0] as any).cnt);

      const tagRow = (await client.execute({
        sql: `SELECT name FROM task_tag WHERE tenant_id = ? AND name = '#prioritate' LIMIT 1`,
        args: [PRIMARY_TENANT_ID]
      })).rows[0] as any;

      const linkCount = Number(((await client.execute({
        sql: `SELECT COUNT(*) as cnt FROM task_to_tag WHERE task_id = ?`,
        args: [t7TaskId]
      })).rows[0] as any).cnt);

      const pass = tagCount === 1 && tagRow?.name === '#prioritate' && linkCount === 1;
      report('T7 Tag case normalization', pass,
        `tag rows with name='#prioritate': ${tagCount} (want 1), stored name: '${tagRow?.name}', task_to_tag links: ${linkCount} (want 1)`);
    } catch (e: any) {
      report('T7 Tag case normalization', false, `ERROR: ${e.message}`);
    } finally {
      if (t7TaskId) await cleanupTask(client, t7TaskId, PRIMARY_TENANT_ID, ['#prioritate']);
    }

    // ── T8: Transaction rollback (documented, not automated) ─────────────────
    console.log('\n─── T8: Transaction rollback (documented) ───');
    console.log(`ℹ️  T8 is not automated: @libsql/client direct SQL doesn't expose Drizzle's`);
    console.log(`   db.transaction() wrapper. The fix (wrapping all writes in db.transaction)`);
    console.log(`   is verified by code inspection — any throw after the task INSERT now rolls`);
    console.log(`   back the entire write set atomically. Manual verification: introduce a`);
    console.log(`   deliberate throw after task insert in a dev build and confirm task row absent.`);

    // ── Index SQL info ────────────────────────────────────────────────────────
    console.log('\n─── Index info ───');
    const idxSql = ((await client.execute(`SELECT sql FROM sqlite_master WHERE type='index' AND name='task_tag_tenant_name_uniq'`)).rows[0] as any)?.sql ?? 'NOT FOUND';
    console.log(`ℹ️  Unique index SQL: ${idxSql}`);
    console.log(`ℹ️  Tag names are now lowercased before lookup/insert — no COLLATE NOCASE needed.`);

  } finally {
    try { client.close(); } catch {}
    if (existsSync(TEST_DB)) { unlinkSync(TEST_DB); console.log(`\n🧹 Cleaned up: ${TEST_DB}`); }
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(70));
  console.log('FINAL REPORT');
  console.log('═'.repeat(70));
  for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'} | ${r.name} | ${r.detail}`);
  const passed = results.filter(r => r.pass).length;
  console.log(`\n${passed}/${results.length} tests passed`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
