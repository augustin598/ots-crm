#!/usr/bin/env bun
/**
 * READ-ONLY: Audit campanii Meta din CRM vs starea reală la Meta Graph API.
 * Categorizează: live_active | live_paused | test_orphan | draft_unused
 * Usage: cd app && bun scripts/_audit-meta-campaigns.ts
 */
import { createClient } from '@libsql/client';
import { createHmac } from 'node:crypto';
import { config } from 'dotenv';
import { resolve } from 'node:path';

config({ path: resolve(import.meta.dir, '..', '.env') });

const SQLITE_URI = process.env.SQLITE_URI!;
const SQLITE_AUTH_TOKEN = process.env.SQLITE_AUTH_TOKEN;
const META_APP_SECRET = process.env.META_APP_SECRET!;
const META_GRAPH_URL = 'https://graph.facebook.com/v25.0';

if (!SQLITE_URI) { console.error('SQLITE_URI missing'); process.exit(1); }
if (!META_APP_SECRET) { console.error('META_APP_SECRET missing'); process.exit(1); }

const db = createClient({ url: SQLITE_URI, authToken: SQLITE_AUTH_TOKEN });

function hmac(token: string, secret: string): string {
	return createHmac('sha256', secret).update(token).digest('hex');
}

async function getMetaCampaignStatus(
	campaignId: string,
	accessToken: string
): Promise<{ status: string; name: string; effective_status: string } | 'NOT_FOUND' | 'ERROR'> {
	try {
		const proof = hmac(accessToken, META_APP_SECRET);
		const url = `${META_GRAPH_URL}/${campaignId}?fields=id,name,status,effective_status&access_token=${accessToken}&appsecret_proof=${proof}`;
		const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
		const data: any = await res.json();
		if (data.error) {
			if (data.error.code === 100 || data.error.code === 803 || /does not exist/.test(data.error.message || '')) {
				return 'NOT_FOUND';
			}
			return 'ERROR';
		}
		return { status: data.status, name: data.name, effective_status: data.effective_status };
	} catch {
		return 'ERROR';
	}
}

async function main() {
	// 1. Fetch all meta campaigns
	const result = await db.execute({
		sql: `SELECT
			c.id,
			c.name,
			c.status,
			c.build_step,
			c.external_campaign_id,
			c.external_ad_account_id,
			c.client_id,
			c.budget_type,
			c.budget_cents / 100.0 as budget_ron,
			c.approved_at,
			c.last_error,
			c.created_at,
			c.updated_at
		FROM campaign c
		WHERE c.platform = 'meta'
		ORDER BY c.created_at DESC
		LIMIT 30`,
		args: []
	});

	const campaigns = result.rows;
	console.error(`[info] Found ${campaigns.length} meta campaigns in CRM`);

	// 2. Get access tokens per ad account
	const accountTokenMap = new Map<string, string>();
	for (const row of campaigns) {
		const accountId = row.external_ad_account_id as string | null;
		if (accountId && !accountTokenMap.has(accountId)) {
			const tokenRes = await db.execute({
				sql: `SELECT i.access_token
				      FROM meta_ads_integration i
				      JOIN meta_ads_account a ON a.integration_id = i.id
				      WHERE a.meta_ad_account_id = ?
				        AND a.is_active = 1
				      LIMIT 1`,
				args: [accountId]
			});
			if (tokenRes.rows.length > 0 && tokenRes.rows[0]!.access_token) {
				accountTokenMap.set(accountId, tokenRes.rows[0]!.access_token as string);
				console.error(`[info] Got token for account ${accountId}`);
			} else {
				// Fallback: try without account join
				const tokenRes2 = await db.execute({
					sql: `SELECT access_token FROM meta_ads_integration WHERE is_active = 1 LIMIT 1`,
					args: []
				});
				if (tokenRes2.rows.length > 0 && tokenRes2.rows[0]!.access_token) {
					accountTokenMap.set(accountId, tokenRes2.rows[0]!.access_token as string);
					console.error(`[info] Got fallback token for account ${accountId}`);
				} else {
					console.error(`[warn] No token found for account ${accountId}`);
				}
			}
		}
	}

	const now = new Date();
	const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000);

	// 3. Audit each campaign
	const auditResults: any[] = [];
	const summary = { total: 0, live_active: 0, live_paused: 0, test_orphan: 0, draft_unused: 0 };

	for (const row of campaigns) {
		summary.total++;
		const id = row.id as string;
		const name = row.name as string;
		const crmStatus = row.status as string;
		const externalId = row.external_campaign_id as string | null;
		const accountId = row.external_ad_account_id as string | null;
		const budgetRon = row.budget_ron as number;
		const approvedAt = row.approved_at as string | null;
		const lastError = row.last_error as string | null;
		const createdAt = row.created_at as string;

		let metaStatus: string = 'N/A';
		let metaEffectiveStatus: string = 'N/A';
		let category: string;
		let recommendedAction: string;

		if (externalId) {
			const token = accountId ? accountTokenMap.get(accountId) : undefined;
			if (token) {
				const metaResult = await getMetaCampaignStatus(externalId, token);
				if (metaResult === 'NOT_FOUND') {
					metaStatus = 'NOT_FOUND';
					metaEffectiveStatus = 'NOT_FOUND';
				} else if (metaResult === 'ERROR') {
					metaStatus = 'ERROR';
					metaEffectiveStatus = 'ERROR';
				} else {
					metaStatus = metaResult.status;
					metaEffectiveStatus = metaResult.effective_status;
				}
			} else {
				metaStatus = 'NO_TOKEN';
				metaEffectiveStatus = 'NO_TOKEN';
			}
		}

		// Categorize
		const isOld = new Date(createdAt) < sevenDaysAgo;
		if (externalId && (metaStatus === 'ACTIVE' || metaEffectiveStatus === 'ACTIVE')) {
			category = 'live_active';
			recommendedAction = 'keep';
			summary.live_active++;
		} else if (externalId && (metaStatus === 'PAUSED' || metaEffectiveStatus === 'PAUSED' || metaEffectiveStatus === 'CAMPAIGN_PAUSED')) {
			category = 'live_paused';
			recommendedAction = 'keep';
			summary.live_paused++;
		} else if (crmStatus === 'failed' || metaStatus === 'NOT_FOUND' || metaEffectiveStatus === 'DELETED') {
			category = 'test_orphan';
			if (metaStatus === 'NOT_FOUND') {
				recommendedAction = 'delete_crm';
			} else {
				recommendedAction = 'delete_both';
			}
			summary.test_orphan++;
		} else if ((crmStatus === 'pending_approval' || crmStatus === 'draft') && isOld) {
			category = 'draft_unused';
			recommendedAction = 'delete_crm';
			summary.draft_unused++;
		} else {
			// pending_approval recent, building, etc.
			category = 'review_needed';
			recommendedAction = 'keep';
		}

		auditResults.push({
			id,
			name,
			external_campaign_id: externalId ?? null,
			external_ad_account_id: accountId ?? null,
			crm_status: crmStatus,
			meta_status: metaStatus,
			meta_effective_status: metaEffectiveStatus,
			category,
			budget_ron: budgetRon,
			approved_at: approvedAt,
			last_error: lastError ? lastError.substring(0, 120) : null,
			created_at: createdAt,
			recommended_action: recommendedAction
		});
	}

	const output = {
		summary: {
			total_campaigns: summary.total,
			live_active: summary.live_active,
			live_paused: summary.live_paused,
			test_orphan: summary.test_orphan,
			draft_unused: summary.draft_unused,
			review_needed: summary.total - summary.live_active - summary.live_paused - summary.test_orphan - summary.draft_unused
		},
		campaigns: auditResults
	};

	console.log(JSON.stringify(output, null, 2));
}

main().catch(console.error).finally(() => db.close());
