import { createClient } from '@libsql/client';

const SQLITE_URI = process.env.SQLITE_URI;
const SQLITE_AUTH_TOKEN = process.env.SQLITE_AUTH_TOKEN;

if (!SQLITE_URI || !SQLITE_AUTH_TOKEN) {
  console.error('Missing SQLITE_URI or SQLITE_AUTH_TOKEN env vars');
  process.exit(1);
}

const client = createClient({ url: SQLITE_URI, authToken: SQLITE_AUTH_TOKEN });

interface MigrationCheck {
  id: string;
  table: string;
  isNewTable?: boolean;
  column?: string;
  columns?: string[];
}

const RECENT_MIGRATIONS: MigrationCheck[] = [
  { id: '0220', table: 'api_key', isNewTable: true, columns: ['id', 'tenant_id', 'name', 'key_hash'] },
  { id: '0221', table: 'campaign', isNewTable: true, columns: ['id', 'tenant_id', 'platform', 'status'] },
  { id: '0221', table: 'campaign_audit', isNewTable: true, columns: ['id', 'campaign_id'] },
  { id: '0221', table: 'campaign_idempotency', isNewTable: true, columns: ['id', 'idempotency_key'] },
  { id: '0221', table: 'meta_targeting_cache', isNewTable: true, columns: ['id', 'type', 'query'] },
  { id: '0222', table: 'meta_ads_account', column: 'is_primary' },
  { id: '0223', table: 'ad_monitor_target', isNewTable: true, columns: ['id', 'tenant_id', 'external_campaign_id'] },
  { id: '0224', table: 'ad_metric_snapshot', isNewTable: true, columns: ['id', 'tenant_id', 'date'] },
  { id: '0225', table: 'user_telegram_link', isNewTable: true, columns: ['id', 'user_id', 'link_code'] },
  { id: '0226', table: 'ad_optimization_recommendation', isNewTable: true, columns: ['id', 'tenant_id', 'action'] },
  { id: '0227', table: 'ad_monitor_target_audit', isNewTable: true, columns: ['id', 'target_id', 'action'] },
  { id: '0227', table: 'ad_recommendation_feedback', isNewTable: true, columns: ['id', 'recommendation_id'] },
  { id: '0227', table: 'ad_monitor_target', column: 'notes' },
  { id: '0227', table: 'ad_monitor_target', column: 'suppressed_actions' },
  { id: '0229', table: 'ad_monitor_target', column: 'external_campaign_name' },
  { id: '0230', table: 'ads_optimization_task', isNewTable: true, columns: ['id', 'tenant_id', 'target_id', 'status', 'scheduled_for'] },
  { id: '0234', table: 'ad_optimization_recommendation', column: 'decision_rationale_json' },
  { id: '0235', table: 'ad_optimization_recommendation', column: 'baseline_cpl_cents' },
  { id: '0236', table: 'ad_optimization_recommendation', column: 'outcome_cpl_cents_7d' },
  { id: '0237', table: 'ad_optimization_recommendation', column: 'outcome_verdict' },
  { id: '0238', table: 'ad_optimization_recommendation', column: 'outcome_evaluated_at' },
  { id: '0239', table: 'ad_monitor_target', column: 'snooze_until' },
  { id: '0240', table: 'ads_optimization_task', column: 'claimed_by_instance_id' },
  { id: '0241', table: 'personalops_instance', isNewTable: true, columns: ['id', 'tenant_id', 'instance_id', 'last_heartbeat_at'] },
  { id: '0242', table: 'meta_ads_integration', column: 'last_token_check_at' },
  { id: '0243', table: 'ad_monitor_target', column: 'optimizer_paused_until' },
  { id: '0244', table: 'ad_monitor_target', column: 'optimizer_paused_reason' },
  { id: '0245', table: 'telegram_messages', isNewTable: true, columns: ['id', 'chat_id', 'text_snippet', 'ok', 'created_at'] },
  { id: '0246', table: 'telegram_messages', column: 'chat_id' },
  { id: '0247', table: 'telegram_messages', column: 'created_at' },
  // Tasks Faza 1 — Phase 1 Foundation
  { id: '0302', table: 'task', column: 'type' },
  { id: '0303', table: 'subtask', isNewTable: true, columns: ['id', 'task_id', 'tenant_id', 'title', 'done', 'position', 'created_at', 'updated_at'] },
  { id: '0304', table: 'subtask', column: 'task_id' },
  { id: '0305', table: 'subtask', column: 'tenant_id' },
  { id: '0306', table: 'task_tag', isNewTable: true, columns: ['id', 'tenant_id', 'name', 'color', 'created_at'] },
  { id: '0307', table: 'task_tag', column: 'tenant_id' },
  { id: '0308', table: 'task_tag', column: 'name' },
  { id: '0309', table: 'task_to_tag', isNewTable: true, columns: ['task_id', 'tag_id', 'tenant_id'] },
  { id: '0310', table: 'task_to_tag', column: 'task_id' },
  { id: '0311', table: 'task_to_tag', column: 'tag_id' },
  { id: '0312', table: 'task_assignee', isNewTable: true, columns: ['task_id', 'user_id', 'tenant_id', 'role', 'created_at'] },
  { id: '0313', table: 'task_assignee', column: 'user_id' },
  { id: '0314', table: 'task_assignee', column: 'tenant_id' },
  { id: '0315', table: 'task', column: 'meet_time' },
  { id: '0316', table: 'task', column: 'meet_duration_minutes' },
  { id: '0317', table: 'task_comment_reaction', isNewTable: true, columns: ['id', 'comment_id', 'user_id', 'tenant_id', 'emoji', 'created_at'] },
  { id: '0318', table: 'task_comment_reaction', column: 'comment_id' },
  { id: '0319', table: 'task_comment_reaction', column: 'comment_id' },
  { id: '0320', table: 'task_comment_reaction', column: 'tenant_id' },
  { id: '0321', table: 'task', column: 'meet_link' },
];

async function main() {
  const tableCache: Record<string, string[]> = {};
  const missing: string[] = [];
  const ok: string[] = [];

  for (const m of RECENT_MIGRATIONS) {
    if (!tableCache[m.table]) {
      try {
        const r = await client.execute(`PRAGMA table_info(${m.table})`);
        tableCache[m.table] = r.rows.map((row: any) => row.name);
      } catch {
        tableCache[m.table] = [];
      }
    }
    const cols = tableCache[m.table];

    const label = m.column
      ? `${m.id} ${m.table}.${m.column}`
      : `${m.id} TABLE ${m.table}`;

    if (cols.length === 0) {
      console.log(`❌ MISSING_TABLE  ${label}`);
      missing.push(label);
      continue;
    }

    if (m.column) {
      if (cols.includes(m.column)) {
        console.log(`✅ ok             ${label}`);
        ok.push(label);
      } else {
        console.log(`❌ MISSING_COLUMN ${label}`);
        missing.push(label);
      }
      continue;
    }

    if (m.isNewTable && m.columns) {
      const missingCols = m.columns.filter(c => !cols.includes(c));
      if (missingCols.length > 0) {
        console.log(`❌ MISSING_COLS   ${label} — missing: ${missingCols.join(', ')}`);
        missing.push(`${label} (cols: ${missingCols.join(', ')})`);
      } else {
        console.log(`✅ ok             ${label}`);
        ok.push(label);
      }
    }
  }

  console.log('');
  console.log(`Summary: ${ok.length} ok, ${missing.length} missing`);

  if (missing.length > 0) {
    console.log('');
    console.log('MISSING:');
    for (const m of missing) console.log(`  - ${m}`);
    process.exit(1);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
