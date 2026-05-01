#!/usr/bin/env bun
/**
 * Read-only diagnostic: verifică statusul live al tokenelor Meta + Google Ads + Gmail
 * pentru clientul BeOne Medical (g4gjn3qe6o734r64xiystdst).
 * Nu modifică nimic. Nu loghează tokenii completi.
 *
 * Usage: cd app && bun scripts/diag-beone-token-health.ts
 */
import { createClient } from '@libsql/client';
import {
	createCipheriv,
	createDecipheriv,
	randomBytes,
	pbkdf2Sync,
	createHash,
	createHmac
} from 'node:crypto';
import { config } from 'dotenv';
import { resolve } from 'node:path';

config({ path: resolve(import.meta.dir, '..', '.env') });

const SQLITE_URI = process.env.SQLITE_URI!;
const SQLITE_AUTH_TOKEN = process.env.SQLITE_AUTH_TOKEN;
const ENCRYPTION_SECRET = process.env.ENCRYPTION_SECRET!;
const META_APP_SECRET = process.env.META_APP_SECRET!;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;

const CLIENT_ID = 'g4gjn3qe6o734r64xiystdst';
const NOW = new Date();

if (!SQLITE_URI) { console.error('SQLITE_URI not set'); process.exit(1); }
if (!ENCRYPTION_SECRET) { console.error('ENCRYPTION_SECRET not set'); process.exit(1); }
if (!META_APP_SECRET) { console.error('META_APP_SECRET not set'); process.exit(1); }

const db = createClient({ url: SQLITE_URI, authToken: SQLITE_AUTH_TOKEN });

// ─── Inline decrypt (mirrors src/lib/server/plugins/smartbill/crypto.ts) ───
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_LENGTH = 32;
const KEY_LENGTH = 32;
const ITERATIONS = 100000;

function deriveKey(tenantId: string): Buffer {
	const salt = pbkdf2Sync(ENCRYPTION_SECRET, tenantId, 1000, SALT_LENGTH, 'sha256');
	return pbkdf2Sync(ENCRYPTION_SECRET, salt.toString('hex'), ITERATIONS, KEY_LENGTH, 'sha256');
}

function decrypt(tenantId: string, encryptedData: string): string {
	const key = deriveKey(tenantId);
	const parts = encryptedData.split(':');
	if (parts.length !== 3) throw new Error(`Bad encrypted format: ${parts.length} parts`);
	const [ivHex, tagHex, encrypted] = parts;
	const iv = Buffer.from(ivHex!, 'hex');
	const tag = Buffer.from(tagHex!, 'hex');
	const decipher = createDecipheriv(ALGORITHM, key, iv);
	decipher.setAuthTag(tag);
	let out = decipher.update(encrypted!, 'hex', 'utf8');
	out += decipher.final('utf8');
	return out;
}

function tokenPreview(t: string | null): string {
	if (!t) return '(null)';
	return `${t.slice(0, 6)}...${t.slice(-4)} (${t.length}c)`;
}

function dbSaysExpired(tokenExpiresAt: string | null): boolean {
	if (!tokenExpiresAt) return false;
	return new Date(tokenExpiresAt) < NOW;
}

// ─── Meta validation ────────────────────────────────────────────────────────
async function testMetaToken(accessToken: string): Promise<{ status: number; ok: boolean; error?: string }> {
	const appsecretProof = createHmac('sha256', META_APP_SECRET).update(accessToken).digest('hex');
	const url = `https://graph.facebook.com/v21.0/me?fields=id,name&appsecret_proof=${appsecretProof}&access_token=${accessToken}`;
	try {
		const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
		const json = await res.json() as Record<string, unknown>;
		if (json.error) {
			const e = json.error as Record<string, unknown>;
			return { status: res.status, ok: false, error: `[${e.code}] ${e.message}` };
		}
		return { status: res.status, ok: res.ok };
	} catch (e) {
		return { status: 0, ok: false, error: String(e) };
	}
}

// ─── Google Ads validation ──────────────────────────────────────────────────
async function testGoogleAdsToken(accessToken: string): Promise<{ status: number; ok: boolean; error?: string }> {
	// Use tokeninfo endpoint — simple, doesn't need developer token
	const url = `https://oauth2.googleapis.com/tokeninfo?access_token=${accessToken}`;
	try {
		const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
		const json = await res.json() as Record<string, unknown>;
		if (!res.ok || json.error_description) {
			return { status: res.status, ok: false, error: String(json.error_description ?? json.error ?? 'unknown') };
		}
		return { status: res.status, ok: true };
	} catch (e) {
		return { status: 0, ok: false, error: String(e) };
	}
}

// ─── Gmail validation ───────────────────────────────────────────────────────
async function testGmailToken(accessToken: string): Promise<{ status: number; ok: boolean; error?: string }> {
	const url = `https://www.googleapis.com/oauth2/v3/userinfo`;
	try {
		const res = await fetch(url, {
			headers: { Authorization: `Bearer ${accessToken}` },
			signal: AbortSignal.timeout(15000)
		});
		const json = await res.json() as Record<string, unknown>;
		if (!res.ok || json.error) {
			return { status: res.status, ok: false, error: String(json.error_description ?? json.error ?? 'unknown') };
		}
		return { status: res.status, ok: true };
	} catch (e) {
		return { status: 0, ok: false, error: String(e) };
	}
}

// ─── Google token refresh (to get fresh access_token for validation) ────────
async function refreshGoogleToken(refreshToken: string): Promise<{ accessToken: string | null; error?: string }> {
	try {
		const res = await fetch('https://oauth2.googleapis.com/token', {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				client_id: GOOGLE_CLIENT_ID,
				client_secret: GOOGLE_CLIENT_SECRET,
				refresh_token: refreshToken,
				grant_type: 'refresh_token'
			}).toString(),
			signal: AbortSignal.timeout(15000)
		});
		const json = await res.json() as Record<string, unknown>;
		if (!res.ok || json.error) {
			return { accessToken: null, error: String(json.error_description ?? json.error ?? 'unknown') };
		}
		return { accessToken: json.access_token as string };
	} catch (e) {
		return { accessToken: null, error: String(e) };
	}
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
	console.error(`[diag] BeOne Medical token health check — ${NOW.toISOString()}`);

	// Find tenant for this client
	const clientRow = await db.execute({
		sql: `SELECT id, tenant_id FROM client WHERE id = ?`,
		args: [CLIENT_ID]
	});
	if (!clientRow.rows.length) {
		console.error('CLIENT NOT FOUND');
		process.exit(1);
	}
	const tenantId = clientRow.rows[0]!.tenant_id as string;
	console.error(`[diag] tenant_id: ${tenantId}`);

	// ── Meta ─────────────────────────────────────────────────────────────────
	console.error('[diag] Querying Meta...');
	const metaRows = await db.execute({
		sql: `SELECT
		        a.id, a.account_name, a.meta_ad_account_id,
		        i.id as integration_id, i.access_token, i.token_expires_at,
		        i.last_refresh_attempt_at, i.last_refresh_error, i.consecutive_refresh_failures
		      FROM meta_ads_account a
		      JOIN meta_ads_integration i ON i.id = a.integration_id
		      WHERE a.client_id = ? AND a.is_active = 1`,
		args: [CLIENT_ID]
	});

	const meta_integrations: unknown[] = [];
	// Deduplicate by integration_id — one integration can have multiple accounts
	const seenMetaIntegrations = new Set<string>();
	for (const row of metaRows.rows) {
		const integrationId = row.integration_id as string;
		const accessToken = row.access_token as string;
		const tokenExpiresAt = row.token_expires_at as string | null;

		// Only test each integration once
		let liveResult: { status: number; ok: boolean; error?: string } | null = null;
		if (!seenMetaIntegrations.has(integrationId)) {
			seenMetaIntegrations.add(integrationId);
			console.error(`[diag] Testing Meta integration ${integrationId}...`);
			liveResult = await testMetaToken(accessToken);
		}

		const expired = dbSaysExpired(tokenExpiresAt);
		const liveOk = liveResult?.ok ?? null;

		let verdict: string;
		if (liveOk === null) verdict = 'skipped_duplicate_integration';
		else if (!expired && liveOk) verdict = 'ok';
		else if (expired && liveOk) verdict = 'stale_db_but_live_works';
		else if (!expired && !liveOk) verdict = 'real_expiry_or_revoked';
		else verdict = 'real_expiry';

		meta_integrations.push({
			account_id: row.id,
			account_name: row.account_name,
			meta_ad_account_id: row.meta_ad_account_id,
			integration_id: integrationId,
			token_preview: tokenPreview(accessToken),
			db_token_expires_at: tokenExpiresAt,
			db_says_expired: expired,
			last_refresh_attempt_at: row.last_refresh_attempt_at,
			last_refresh_error: row.last_refresh_error,
			consecutive_refresh_failures: row.consecutive_refresh_failures,
			...(liveResult
				? { live_test_status: liveResult.status, live_says_valid: liveResult.ok, live_error: liveResult.error ?? null }
				: {}),
			verdict
		});
	}

	// ── Google Ads ────────────────────────────────────────────────────────────
	console.error('[diag] Querying Google Ads...');
	const googleRows = await db.execute({
		sql: `SELECT
		        i.id, i.email, i.access_token, i.refresh_token, i.token_expires_at,
		        i.last_refresh_attempt_at, i.last_refresh_error, i.consecutive_refresh_failures,
		        a.google_ads_customer_id, a.account_name
		      FROM google_ads_account a
		      JOIN google_ads_integration i ON i.id = a.integration_id
		      WHERE a.client_id = ?`,
		args: [CLIENT_ID]
	});

	const google_ads_integrations: unknown[] = [];
	const seenGoogleIntegrations = new Set<string>();
	for (const row of googleRows.rows) {
		const integrationId = row.id as string;
		const accessToken = row.access_token as string;
		const refreshToken = row.refresh_token as string;
		const tokenExpiresAt = row.token_expires_at as string | null;

		let liveResult: { status: number; ok: boolean; error?: string } | null = null;
		let refreshedToken: string | null = null;
		let refreshError: string | null = null;

		if (!seenGoogleIntegrations.has(integrationId)) {
			seenGoogleIntegrations.add(integrationId);
			console.error(`[diag] Testing Google Ads integration ${integrationId}...`);

			// Try existing access token first
			liveResult = await testGoogleAdsToken(accessToken);

			// If expired, try to refresh and re-test
			if (!liveResult.ok && refreshToken) {
				console.error(`[diag] Google token invalid, attempting refresh...`);
				const refreshed = await refreshGoogleToken(refreshToken);
				if (refreshed.accessToken) {
					refreshedToken = refreshed.accessToken;
					liveResult = await testGoogleAdsToken(refreshedToken);
				} else {
					refreshError = refreshed.error ?? null;
				}
			}
		}

		const expired = dbSaysExpired(tokenExpiresAt);
		const liveOk = liveResult?.ok ?? null;

		let verdict: string;
		if (liveOk === null) verdict = 'skipped_duplicate_integration';
		else if (!expired && liveOk && !refreshedToken) verdict = 'ok';
		else if (liveOk && refreshedToken) verdict = 'refreshed_ok_but_db_stale';
		else if (expired && liveOk) verdict = 'stale_db_but_live_works';
		else if (!liveOk && refreshError) verdict = `refresh_failed: ${refreshError}`;
		else verdict = 'real_expiry_or_revoked';

		google_ads_integrations.push({
			integration_id: integrationId,
			email: row.email,
			customer_id: row.google_ads_customer_id,
			account_name: row.account_name,
			access_token_preview: tokenPreview(accessToken),
			db_token_expires_at: tokenExpiresAt,
			db_says_expired: expired,
			last_refresh_attempt_at: row.last_refresh_attempt_at,
			last_refresh_error: row.last_refresh_error,
			consecutive_refresh_failures: row.consecutive_refresh_failures,
			...(liveResult
				? { live_test_status: liveResult.status, live_says_valid: liveResult.ok, live_error: liveResult.error ?? null }
				: {}),
			refresh_attempted: !!refreshedToken || !!refreshError,
			refresh_succeeded: !!refreshedToken,
			verdict
		});
	}

	// ── Gmail ─────────────────────────────────────────────────────────────────
	console.error('[diag] Querying Gmail...');
	const gmailRows = await db.execute({
		sql: `SELECT id, email, access_token, access_token_encrypted, refresh_token, refresh_token_encrypted,
		             token_expires_at, last_refresh_attempt_at, last_refresh_error, consecutive_refresh_failures
		      FROM gmail_integration
		      WHERE tenant_id = ?`,
		args: [tenantId]
	});

	const gmail_integrations: unknown[] = [];
	for (const row of gmailRows.rows) {
		const integrationId = row.id as string;
		const tokenExpiresAt = row.token_expires_at as string | null;

		// Resolve access token: prefer encrypted column
		let accessToken: string | null = null;
		let tokenSource = 'none';
		const encryptedAt = row.access_token_encrypted as string | null;
		const plainAt = row.access_token as string | null;

		if (encryptedAt) {
			try {
				accessToken = decrypt(tenantId, encryptedAt);
				tokenSource = 'encrypted_column';
			} catch (e) {
				console.error(`[diag] Gmail decrypt failed: ${e} — falling back to plain`);
				accessToken = plainAt;
				tokenSource = 'plain_fallback';
			}
		} else if (plainAt) {
			accessToken = plainAt;
			tokenSource = 'plain_column';
		}

		let liveResult: { status: number; ok: boolean; error?: string } | null = null;
		let refreshedToken: string | null = null;
		let refreshError: string | null = null;

		console.error(`[diag] Testing Gmail integration ${integrationId}...`);

		if (accessToken) {
			liveResult = await testGmailToken(accessToken);

			// If expired, attempt refresh
			if (!liveResult.ok) {
				const encryptedRt = row.refresh_token_encrypted as string | null;
				const plainRt = row.refresh_token as string | null;
				let refreshToken: string | null = null;

				if (encryptedRt) {
					try { refreshToken = decrypt(tenantId, encryptedRt); } catch { refreshToken = plainRt; }
				} else {
					refreshToken = plainRt;
				}

				if (refreshToken) {
					console.error(`[diag] Gmail access token invalid, attempting refresh...`);
					const refreshed = await refreshGoogleToken(refreshToken);
					if (refreshed.accessToken) {
						refreshedToken = refreshed.accessToken;
						liveResult = await testGmailToken(refreshedToken);
					} else {
						refreshError = refreshed.error ?? null;
					}
				}
			}
		}

		const expired = dbSaysExpired(tokenExpiresAt);
		const liveOk = liveResult?.ok ?? null;

		let verdict: string;
		if (!accessToken) verdict = 'no_token_found';
		else if (liveOk && !refreshedToken) verdict = expired ? 'stale_db_but_live_works' : 'ok';
		else if (liveOk && refreshedToken) verdict = 'refreshed_ok_but_db_stale';
		else if (!liveOk && refreshError) verdict = `refresh_failed: ${refreshError}`;
		else verdict = 'real_expiry_or_revoked';

		gmail_integrations.push({
			integration_id: integrationId,
			email: row.email,
			token_source: tokenSource,
			access_token_preview: tokenPreview(accessToken),
			db_token_expires_at: tokenExpiresAt,
			db_says_expired: expired,
			last_refresh_attempt_at: row.last_refresh_attempt_at,
			last_refresh_error: row.last_refresh_error,
			consecutive_refresh_failures: row.consecutive_refresh_failures,
			...(liveResult
				? { live_test_status: liveResult.status, live_says_valid: liveResult.ok, live_error: liveResult.error ?? null }
				: {}),
			refresh_attempted: !!refreshedToken || !!refreshError,
			refresh_succeeded: !!refreshedToken,
			verdict
		});
	}

	// ── Summary ───────────────────────────────────────────────────────────────
	const allVerdicts = [
		...((meta_integrations as Array<Record<string, unknown>>).map(x => x.verdict as string)),
		...((google_ads_integrations as Array<Record<string, unknown>>).map(x => x.verdict as string)),
		...((gmail_integrations as Array<Record<string, unknown>>).map(x => x.verdict as string))
	];
	const hasProblems = allVerdicts.some(v =>
		v !== 'ok' && v !== 'stale_db_but_live_works' && v !== 'skipped_duplicate_integration'
	);
	const hasStaleDb = allVerdicts.some(v => v === 'stale_db_but_live_works');
	const overall_health = hasProblems ? 'needs_action' : hasStaleDb ? 'mixed' : 'all_good';

	const actions_recommended: string[] = [];
	if (hasStaleDb) actions_recommended.push('Run token refresh / update token_expires_at in DB for stale entries');
	if (allVerdicts.some(v => v.includes('refresh_failed'))) {
		actions_recommended.push('Re-authenticate integration — refresh token rejected by Google OAuth');
	}
	if (allVerdicts.some(v => v === 'real_expiry_or_revoked')) {
		actions_recommended.push('Re-authenticate expired/revoked integration');
	}
	if (allVerdicts.some(v => v === 'refreshed_ok_but_db_stale')) {
		actions_recommended.push('Persist fresh access_token to DB (tryPersist issue)');
	}

	const result = {
		checked_at: NOW.toISOString(),
		client_id: CLIENT_ID,
		tenant_id: tenantId,
		meta_integrations,
		google_ads_integrations,
		gmail_integrations,
		overall_health,
		actions_recommended
	};

	console.log(JSON.stringify(result, null, 2));
}

main().catch(e => {
	console.error('FATAL:', e);
	process.exit(1);
});
