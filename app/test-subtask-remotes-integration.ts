/**
 * Integration test — subtask remotes (Faza 2 Part 2)
 * Tests DB-layer logic mirroring toggleSubtask / addSubtask / deleteSubtask
 * Uses an isolated temp DB so local.db is never touched.
 *
 * Run: bun test-subtask-remotes-integration.ts
 */
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { sql, eq, and, desc } from 'drizzle-orm';
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { existsSync, unlinkSync } from 'node:fs';

// ─── Minimal schema (mirrors actual schema) ──────────────────────────────────

const task = sqliteTable('task', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  title: text('title').notNull(),
  status: text('status').notNull().default('todo'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

const subtask = sqliteTable('subtask', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull(),
  tenantId: text('tenant_id').notNull(),
  title: text('title').notNull(),
  done: integer('done').notNull().default(0),
  position: integer('position').notNull().default(0),
  createdByUserId: text('created_by_user_id'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function id() {
  const bytes = crypto.getRandomValues(new Uint8Array(15));
  const chars = 'abcdefghijklmnopqrstuvwxyz234567';
  let s = '';
  for (const b of bytes) s += chars[b & 31];
  return s;
}

let passed = 0, failed = 0;
function assert(name: string, condition: boolean, detail?: string) {
  if (!condition) {
    console.error(`❌ FAIL: ${name}${detail ? ` — ${detail}` : ''}`);
    failed++;
  } else {
    console.log(`✅ PASS: ${name}`);
    passed++;
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const DB_FILE = 'test-subtask-temp.db';

async function main() {
  if (existsSync(DB_FILE)) unlinkSync(DB_FILE);

  const client = createClient({ url: `file:${DB_FILE}` });
  const db = drizzle(client, { schema: { task, subtask } });

  // Create tables
  await client.execute(`
    CREATE TABLE IF NOT EXISTS task (
      id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'todo',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  await client.execute(`
    CREATE TABLE IF NOT EXISTS subtask (
      id TEXT PRIMARY KEY NOT NULL,
      task_id TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      title TEXT NOT NULL,
      done INTEGER NOT NULL DEFAULT 0,
      position INTEGER NOT NULL DEFAULT 0,
      created_by_user_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (task_id) REFERENCES task(id) ON DELETE CASCADE
    )
  `);

  // ── Test fixtures ────────────────────────────────────────────────────────────
  const TENANT_A = 'test-tenant-alpha';
  const TENANT_B = 'test-tenant-beta';
  const USER_A   = 'user-augustin';
  const now      = Date.now();

  // Create parent task for Tenant A
  const parentTaskId = id();
  await db.insert(task).values({
    id: parentTaskId,
    tenantId: TENANT_A,
    title: 'Task principal — Campanie reclamă',
    status: 'in-progress',
    createdAt: now,
    updatedAt: now,
  });

  // Create parent task for Tenant B (for cross-tenant tests)
  const tenantBTaskId = id();
  await db.insert(task).values({
    id: tenantBTaskId,
    tenantId: TENANT_B,
    title: 'Task tenant Beta',
    status: 'todo',
    createdAt: now,
    updatedAt: now,
  });

  const createdSubtaskIds: string[] = [];

  try {
    // ── T1: addSubtask — auto-position ─────────────────────────────────────────
    console.log('\n── T1: addSubtask auto-position ──');

    // Mirror addSubtask logic: verify task belongs to tenant, compute position
    const [taskA] = await db
      .select({ id: task.id, tenantId: task.tenantId })
      .from(task)
      .where(and(eq(task.id, parentTaskId), eq(task.tenantId, TENANT_A)))
      .limit(1);
    assert('T1 task lookup tenant-scoped', !!taskA);

    for (let i = 0; i < 3; i++) {
      const [last] = await db
        .select({ position: subtask.position })
        .from(subtask)
        .where(eq(subtask.taskId, parentTaskId))
        .orderBy(desc(subtask.position))
        .limit(1);
      const position = (last?.position ?? -1) + 1;
      const sid = id();
      createdSubtaskIds.push(sid);
      await db.insert(subtask).values({
        id: sid,
        taskId: parentTaskId,
        tenantId: TENANT_A,
        title: `Subtask ${i + 1} — Conținut grafic`,
        done: 0,
        position,
        createdByUserId: USER_A,
        createdAt: now,
        updatedAt: now,
      });
      assert(`T1 subtask[${i}] inserted at position ${i}`, position === i, `got ${position}`);
    }

    const allSubs = await db
      .select()
      .from(subtask)
      .where(eq(subtask.taskId, parentTaskId))
      .orderBy(subtask.position);
    assert('T1 exactly 3 subtasks created', allSubs.length === 3, `got ${allSubs.length}`);

    // ── T2: toggleSubtask done=true ────────────────────────────────────────────
    console.log('\n── T2: toggleSubtask done=true on subtask[1] ──');

    const sub1Id = createdSubtaskIds[1];
    const [sub1] = await db
      .select()
      .from(subtask)
      .where(and(eq(subtask.id, sub1Id), eq(subtask.tenantId, TENANT_A)))
      .limit(1);
    assert('T2 sub1 found via tenant-scoped lookup', !!sub1);

    await db.update(subtask).set({ done: 1, updatedAt: now + 1 }).where(eq(subtask.id, sub1Id));

    const afterT2 = await db
      .select()
      .from(subtask)
      .where(eq(subtask.taskId, parentTaskId))
      .orderBy(subtask.position);
    assert('T2 subtask[1] done=1',       afterT2[1].done === 1, `got ${afterT2[1].done}`);
    assert('T2 subtask[0] still done=0', afterT2[0].done === 0, `got ${afterT2[0].done}`);
    assert('T2 subtask[2] still done=0', afterT2[2].done === 0, `got ${afterT2[2].done}`);

    // ── T3: toggleSubtask done=false ───────────────────────────────────────────
    console.log('\n── T3: toggleSubtask done=false ──');

    await db.update(subtask).set({ done: 0, updatedAt: now + 2 }).where(eq(subtask.id, sub1Id));

    const afterT3 = await db
      .select()
      .from(subtask)
      .where(and(eq(subtask.id, sub1Id), eq(subtask.tenantId, TENANT_A)))
      .limit(1);
    assert('T3 subtask[1] reverted to done=0', afterT3[0]?.done === 0, `got ${afterT3[0]?.done}`);

    // ── T4: deleteSubtask ──────────────────────────────────────────────────────
    console.log('\n── T4: deleteSubtask ──');

    const sub2Id = createdSubtaskIds[2];
    await db
      .delete(subtask)
      .where(and(eq(subtask.id, sub2Id), eq(subtask.tenantId, TENANT_A)));
    createdSubtaskIds.splice(2, 1); // remove from cleanup list since already deleted

    const afterT4 = await db
      .select()
      .from(subtask)
      .where(eq(subtask.taskId, parentTaskId));
    assert('T4 only 2 subtasks remain',    afterT4.length === 2,    `got ${afterT4.length}`);
    assert('T4 deleted subtask gone',      !afterT4.find(s => s.id === sub2Id));
    assert('T4 sub0 still present',        !!afterT4.find(s => s.id === createdSubtaskIds[0]));
    assert('T4 sub1 still present',        !!afterT4.find(s => s.id === createdSubtaskIds[1]));

    // ── T5: Cross-tenant guard — toggleSubtask ─────────────────────────────────
    console.log('\n── T5: Cross-tenant toggleSubtask block ──');

    // Attempt to fetch Tenant A's subtask using Tenant B's tenantId
    const [wrongTenant] = await db
      .select()
      .from(subtask)
      .where(and(eq(subtask.id, createdSubtaskIds[0]), eq(subtask.tenantId, TENANT_B)))
      .limit(1);
    assert('T5 cross-tenant toggleSubtask blocked (no row returned)', !wrongTenant,
      wrongTenant ? `LEAKED: found subtask ${wrongTenant.id}` : undefined);

    // ── T6: Cross-tenant guard — addSubtask ────────────────────────────────────
    console.log('\n── T6: Cross-tenant addSubtask block ──');

    // Attempt to lookup Tenant B's task from Tenant A's context
    const [crossTaskLookup] = await db
      .select({ id: task.id, tenantId: task.tenantId })
      .from(task)
      .where(and(eq(task.id, tenantBTaskId), eq(task.tenantId, TENANT_A))) // wrong tenant
      .limit(1);
    assert('T6 cross-tenant addSubtask blocked (task not found for wrong tenant)', !crossTaskLookup,
      crossTaskLookup ? `LEAKED: found task ${crossTaskLookup.id}` : undefined);

    // ── T7: FK cascade — delete parent task → subtasks cascade ────────────────
    console.log('\n── T7: FK cascade on parent delete ──');

    // Insert a fresh set of subtasks for cascade test
    const cascadeTaskId = id();
    await db.insert(task).values({
      id: cascadeTaskId,
      tenantId: TENANT_A,
      title: 'Task cascade — test ștergere',
      status: 'todo',
      createdAt: now,
      updatedAt: now,
    });
    const cascadeSubIds = [id(), id()];
    for (let i = 0; i < 2; i++) {
      await db.insert(subtask).values({
        id: cascadeSubIds[i],
        taskId: cascadeTaskId,
        tenantId: TENANT_A,
        title: `Subtask cascade ${i + 1}`,
        done: 0,
        position: i,
        createdAt: now,
        updatedAt: now,
      });
    }

    // Enable FK enforcement in SQLite (off by default)
    await client.execute('PRAGMA foreign_keys = ON');
    await db.delete(task).where(eq(task.id, cascadeTaskId));

    const afterCascade = await db
      .select()
      .from(subtask)
      .where(eq(subtask.taskId, cascadeTaskId));
    assert('T7 cascade: all subtasks deleted with parent', afterCascade.length === 0,
      `got ${afterCascade.length} orphan subtasks`);

  } finally {
    // Cleanup: delete any remaining test subtasks and tasks
    for (const sid of createdSubtaskIds) {
      try { await db.delete(subtask).where(eq(subtask.id, sid)); } catch {}
    }
    try { await db.delete(task).where(eq(task.id, parentTaskId)); } catch {}
    try { await db.delete(task).where(eq(task.id, tenantBTaskId)); } catch {}
    if (existsSync(DB_FILE)) unlinkSync(DB_FILE);
  }

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Tests: ${passed + failed} | ✅ ${passed} passed | ${failed > 0 ? '❌' : '✅'} ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
