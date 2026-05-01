#!/usr/bin/env bun
/**
 * Backfill ad_metric_snapshot pentru campania DOUBLO GOLD (6891033633402)
 * Perioadă: 2026-02-13 → 2026-04-28 (~75 zile)
 * Ad account: act_818842774503712 (beonemedical.ro)
 *
 * Usage: cd app && bun scripts/backfill-doublo-gold-snapshots.ts
 */
import { createClient } from '@libsql/client';
import { createHmac, randomBytes } from 'node:crypto';
import { config } from 'dotenv';
import { resolve } from 'node:path';

config({ path: resolve(import.meta.dir, '..', '.env') });

const SQLITE_URI = process.env.SQLITE_URI;
const SQLITE_AUTH_TOKEN = process.env.SQLITE_AUTH_TOKEN;
const META_APP_SECRET = process.env.META_APP_SECRET;

const CAMPAIGN_ID = '6891033633402';
const AD_ACCOUNT_ID = 'act_818842774503712';
const CLIENT_ID = 'g4gjn3qe6o734r64xiystdst';
const META_GRAPH_URL = 'https://graph.facebook.com/v25.0';


const LEARNING_DAYS_MIN = 7;
const SPARSE_CONVERSIONS_MIN = 50;

// 3 ferestre × 30 zile (Meta limitează range-ul pentru daily breakdowns)
const WINDOWS = [
	{ since: '2026-02-13', until: '2026-03-14' },
	{ since: '2026-03-15', until: '2026-04-13' },
	{ since: '2026-04-14', until: '2026-04-28' }
];

interface DailyRow {
	date: string;
	spendCents: number;
	impressions: number;
	clicks: number;
	conversions: number;
	cpcCents: number | null;
	cpmCents: number | null;
	cplCents: number | null;
	ctr: number | null;
	frequency: number | null;
}

if (!SQLITE_URI) { console.error('SQLITE_URI not set'); process.exit(1); }
if (!META_APP_SECRET) { console.error('META_APP_SECRET not set'); process.exit(1); }

const db = createClient({ url: SQLITE_URI, authToken: SQLITE_AUTH_TOKEN });

function appsecretProof(token: string): string {
	return createHmac('sha256', META_APP_SECRET!).update(token).digest('hex');
}

function generateId(): string {
	const bytes = randomBytes(15);
	const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
	let result = '';
	let buffer = 0;
	let bitsLeft = 0;
	for (const byte of bytes) {
		buffer = (buffer << 8) | byte;
		bitsLeft += 8;
		while (bitsLeft >= 5) {
			bitsLeft -= 5;
			result += alphabet[(buffer >> bitsLeft) & 31];
		}
	}
	if (bitsLeft > 0) result += alphabet[(buffer << (5 - bitsLeft)) & 31];
	return result;
}

function getLeads(actions: any[] | undefined): number {
	if (!actions) return 0;
	// Match cron behavior: GOAL_TO_ACTION['LEAD_GENERATION'] = 'lead' only.
	// Do NOT fall back to contact_total / submit_application_total — they inflate counts
	// (generic pixel events, not real leads).
	const lead = actions.find((x: any) => x.action_type === 'lead');
	if (lead) return Math.round(parseFloat(lead.value || '0'));
	const pixelLead = actions.find((x: any) => x.action_type === 'offsite_conversion.fb_pixel_lead');
	if (pixelLead) return Math.round(parseFloat(pixelLead.value || '0'));
	return 0;
}

async function fetchWindow(token: string, since: string, until: string): Promise<DailyRow[]> {
	const proof = appsecretProof(token);
	const filtering = JSON.stringify([{ field: 'campaign.id', operator: 'EQUAL', value: CAMPAIGN_ID }]);

	const rows: DailyRow[] = [];
	let url: string | null = `${META_GRAPH_URL}/${AD_ACCOUNT_ID}/insights?${new URLSearchParams({
		fields: 'date_start,spend,impressions,clicks,frequency,actions',
		level: 'campaign',
		time_range: JSON.stringify({ since, until }),
		time_increment: '1',
		action_attribution_windows: JSON.stringify(['1d_click', '1d_view']),
		filtering,
		access_token: token,
		appsecret_proof: proof,
		limit: '500'
	}).toString()}`;

	while (url) {
		const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
		const data = await res.json() as any;
		if (data.error) throw new Error(`Meta API error [${data.error.code}]: ${data.error.message}`);

		for (const row of data.data || []) {
			const spendCents = Math.round(parseFloat(row.spend || '0') * 100);
			const impressions = parseInt(row.impressions || '0', 10) || 0;
			const clicks = parseInt(row.clicks || '0', 10) || 0;
			const conversions = getLeads(row.actions);

			rows.push({
				date: row.date_start,
				spendCents,
				impressions,
				clicks,
				conversions,
				cpcCents: clicks > 0 ? Math.round(spendCents / clicks) : null,
				cpmCents: impressions > 0 ? Math.round((spendCents / impressions) * 1000) : null,
				cplCents: conversions > 0 ? Math.round(spendCents / conversions) : null,
				// CTR ca proporție (0.025 pentru 2.5%) — consistent cu ads-performance-monitor
				ctr: impressions > 0 ? clicks / impressions : null,
				frequency: row.frequency ? (parseFloat(row.frequency) || null) : null
			});
		}

		url = data.paging?.next || null;
	}

	return rows;
}

function calcMaturity(
	date: string,
	allRows: DailyRow[],
	campaignStartDate: string | null
): 'learning' | 'sparse' | 'mature' {
	let daysRunning: number | null = null;
	if (campaignStartDate) {
		const start = new Date(campaignStartDate + 'T00:00:00Z').getTime();
		const current = new Date(date + 'T00:00:00Z').getTime();
		daysRunning = Math.max(0, Math.floor((current - start) / 86_400_000));
	}

	if (daysRunning !== null && daysRunning < LEARNING_DAYS_MIN) return 'learning';

	// Ultimele 7 zile inclusiv ziua curentă
	const currentTs = new Date(date + 'T00:00:00Z').getTime();
	const window7Start = currentTs - 6 * 86_400_000;
	const conversionsLast7d = allRows
		.filter((r) => {
			const ts = new Date(r.date + 'T00:00:00Z').getTime();
			return ts >= window7Start && ts <= currentTs;
		})
		.reduce((s, r) => s + r.conversions, 0);

	return conversionsLast7d < SPARSE_CONVERSIONS_MIN ? 'sparse' : 'mature';
}

async function main() {
	console.error('[1/5] Citesc tenant și integration din DB...');

	const tenantRow = await db.execute({
		sql: `SELECT id FROM tenant WHERE slug = 'ots' LIMIT 1`,
		args: []
	});
	if (!tenantRow.rows[0]) { console.error('Tenant "ots" negăsit'); process.exit(1); }
	const TENANT_ID = tenantRow.rows[0].id as string;
	console.error(`  tenant_id = ${TENANT_ID}`);

	// Integration pentru ad account-ul beonemedical
	const intRow = await db.execute({
		sql: `SELECT i.id as integration_id, i.access_token
		      FROM meta_ads_account a
		      JOIN meta_ads_integration i ON i.id = a.integration_id
		      WHERE a.client_id = ? AND a.meta_ad_account_id = ?
		      LIMIT 1`,
		args: [CLIENT_ID, AD_ACCOUNT_ID]
	});
	if (!intRow.rows[0]) { console.error(`Integration negăsită pentru ${AD_ACCOUNT_ID}`); process.exit(1); }
	const accessToken = intRow.rows[0].access_token as string;
	const integrationId = intRow.rows[0].integration_id as string;
	console.error(`  integration_id = ${integrationId}, token prezent: ${!!accessToken}`);

	console.error('[2/5] Fetch Meta Insights API (3 ferestre)...');
	const allRows = new Map<string, DailyRow>();

	for (const win of WINDOWS) {
		console.error(`  [Meta] ${win.since} → ${win.until}`);
		const rows = await fetchWindow(accessToken, win.since, win.until);
		console.error(`    → ${rows.length} zile primite`);
		for (const r of rows) {
			allRows.set(r.date, r); // dedup pe dată
		}
	}

	const sorted = Array.from(allRows.values()).sort((a, b) => a.date.localeCompare(b.date));
	console.error(`  Total zile unice: ${sorted.length}`);

	// Campania a pornit în prima zi cu spend > 0 din fereastra noastră
	const firstSpendRow = sorted.find((r) => r.spendCents > 0);
	const campaignStartDate = firstSpendRow?.date ?? null;
	console.error(`  Prima zi cu spend: ${campaignStartDate ?? 'niciuna'}`);

	console.error('[3/5] Inserez/actualizez snapshots în DB...');
	let inserted = 0;
	let updated = 0;

	for (const day of sorted) {
		const maturity = calcMaturity(day.date, sorted, campaignStartDate);

		// Verificăm dacă există deja (UNIQUE pe NULL nu funcționează în SQLite)
		const existing = await db.execute({
			sql: `SELECT id FROM ad_metric_snapshot
			      WHERE tenant_id = ? AND external_campaign_id = ? AND external_adset_id IS NULL AND date = ?
			      LIMIT 1`,
			args: [TENANT_ID, CAMPAIGN_ID, day.date]
		});

		if (existing.rows[0]) {
			await db.execute({
				sql: `UPDATE ad_metric_snapshot SET
				        spend_cents = ?, impressions = ?, clicks = ?, conversions = ?,
				        cpc_cents = ?, cpm_cents = ?, cpa_cents = ?, cpl_cents = ?,
				        ctr = ?, roas = NULL, frequency = ?, maturity = ?,
				        fetched_at = CURRENT_TIMESTAMP
				      WHERE id = ?`,
				args: [
					day.spendCents, day.impressions, day.clicks, day.conversions,
					day.cpcCents, day.cpmCents, day.cplCents, day.cplCents,
					day.ctr, day.frequency, maturity,
					existing.rows[0].id as string
				]
			});
			updated++;
		} else {
			await db.execute({
				sql: `INSERT INTO ad_metric_snapshot
				        (id, tenant_id, client_id, platform, external_campaign_id, external_adset_id,
				         date, spend_cents, impressions, clicks, conversions,
				         cpc_cents, cpm_cents, cpa_cents, cpl_cents,
				         ctr, roas, frequency, maturity, fetched_at)
				      VALUES (?, ?, ?, 'meta', ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, CURRENT_TIMESTAMP)`,
				args: [
					generateId(), TENANT_ID, CLIENT_ID, CAMPAIGN_ID, day.date,
					day.spendCents, day.impressions, day.clicks, day.conversions,
					day.cpcCents, day.cpmCents, day.cplCents, day.cplCents,
					day.ctr, day.frequency, maturity
				]
			});
			inserted++;
		}
	}

	console.error(`  Inserate: ${inserted}, Actualizate: ${updated}`);

	console.error('[4/5] Verificare din DB...');
	const verifyRows = await db.execute({
		sql: `SELECT date, spend_cents, conversions, cpl_cents, ctr, maturity
		      FROM ad_metric_snapshot
		      WHERE external_campaign_id = ? AND tenant_id = ?
		      ORDER BY date DESC
		      LIMIT 20`,
		args: [CAMPAIGN_ID, TENANT_ID]
	});

	console.error('  Ultimele 20 zile (recent → vechi):');
	for (const r of verifyRows.rows) {
		console.error(`    ${r.date}  spend=${((r.spend_cents as number) / 100).toFixed(2)} RON  conv=${r.conversions}  cpl=${r.cpl_cents ? ((r.cpl_cents as number) / 100).toFixed(2) : 'n/a'} RON  maturity=${r.maturity}`);
	}

	console.error('[5/5] Calculez summary...');
	const summaryRow = await db.execute({
		sql: `SELECT
		        COUNT(*) as total_days,
		        SUM(spend_cents) as total_spend_cents,
		        SUM(conversions) as total_conversions,
		        MIN(date) as first_date,
		        MAX(date) as last_date
		      FROM ad_metric_snapshot
		      WHERE external_campaign_id = ? AND tenant_id = ?`,
		args: [CAMPAIGN_ID, TENANT_ID]
	});

	const s = summaryRow.rows[0]!;
	const totalSpendCents = s.total_spend_cents as number || 0;
	const totalConversions = s.total_conversions as number || 0;
	const avgCplRon = totalConversions > 0 ? (totalSpendCents / totalConversions / 100) : 0;

	// CTR medie ponderată (pe zile cu impressions)
	const ctrRow = await db.execute({
		sql: `SELECT AVG(ctr) as avg_ctr FROM ad_metric_snapshot
		      WHERE external_campaign_id = ? AND tenant_id = ? AND ctr IS NOT NULL`,
		args: [CAMPAIGN_ID, TENANT_ID]
	});
	const avgCtr = (ctrRow.rows[0]?.avg_ctr as number) ?? 0;

	// Zile cu spend (active)
	const spendDaysRow = await db.execute({
		sql: `SELECT MIN(date) as first_spend_date FROM ad_metric_snapshot
		      WHERE external_campaign_id = ? AND tenant_id = ? AND spend_cents > 0`,
		args: [CAMPAIGN_ID, TENANT_ID]
	});
	const firstSpendDate = spendDaysRow.rows[0]?.first_spend_date as string ?? null;

	// Maturity curentă (cea mai recentă zi)
	const latestRow = await db.execute({
		sql: `SELECT maturity FROM ad_metric_snapshot
		      WHERE external_campaign_id = ? AND tenant_id = ?
		      ORDER BY date DESC LIMIT 1`,
		args: [CAMPAIGN_ID, TENANT_ID]
	});
	const currentMaturity = latestRow.rows[0]?.maturity as string ?? 'unknown';

	const output = {
		ok: true,
		snapshots_inserted: inserted,
		snapshots_updated: updated,
		date_range: `${s.first_date} → ${s.last_date}`,
		total_days: s.total_days as number,
		summary: {
			total_spend_ron: Math.round((totalSpendCents / 100) * 100) / 100,
			total_conversions: totalConversions,
			avg_cpl_ron: Math.round(avgCplRon * 100) / 100,
			avg_ctr: Math.round(avgCtr * 10000) / 10000,
			first_day_with_spend: firstSpendDate,
			current_maturity: currentMaturity
		},
		ready_for_optimizer_run: true
	};

	console.log(JSON.stringify(output, null, 2));
}

main().catch((err) => {
	console.error('FATAL:', err);
	process.exit(1);
}).finally(() => db.close());
