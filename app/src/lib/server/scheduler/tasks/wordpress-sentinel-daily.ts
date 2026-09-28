/**
 * Sentinel WordPress — jobul zilnic (09:00 Europe/Bucharest).
 *
 * Citește jurnalul Sentinel al fiecărui site WordPress nepauzat (`pullSite`,
 * `trigger: 'daily'`) și trimite UN singur rezumat Telegram per tenant, cu
 * toate site-urile lui. Nu trimite nimic per-site: `pullSite` doar adaugă la
 * `pendingFindings`, jobul ăsta e singurul care golește coada și trimite.
 *
 * Idempotent per tenant per zi calendaristică (ora României): cheia Redis
 * `sentinel:digest:<tenantId>:<YYYY-MM-DD>` se setează DOAR după o livrare
 * reușită (≥ 1 utilizator notificat) — dacă Telegram e jos sau nimeni nu are
 * cont legat, cheia rămâne nesetată și `pendingFindings` rămâne populat, deci
 * rularea de mâine reia automat (self-healing, fără coadă de retry separată).
 *
 * Fiecare site se citește secvențial (ca la `wordpress-updates-check`, ca să
 * nu bombardăm hosting-uri shared); un `pullSite` care aruncă (eroare de
 * infrastructură, nu de site) devine un rezultat sintetic `status: 'error'`
 * — un site picat nu oprește restul flotei.
 */
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, inArray, lt } from 'drizzle-orm';
import { logInfo, logWarning, serializeError } from '$lib/server/logger';
import { getRedis } from '$lib/server/redis';
import { sendTelegramMessage } from '$lib/server/telegram/sender';
import { getAppBaseUrl } from '$lib/server/app-url';
import { pullSite, type PullResult } from '$lib/server/wordpress/sentinel/pull';
import { buildDigest, type DigestSite } from '$lib/server/wordpress/sentinel/digest';
import { parseState, type Finding } from '$lib/server/wordpress/sentinel/types';

export const SENTINEL_RETENTION_DAYS = 7;

/** 36h — puțin peste o zi, ca o rulare întârziată sau reluată azi să nu retrimită digestul de ieri. */
const DIGEST_KEY_TTL_SEC = 36 * 60 * 60;

const bucharestDateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bucharest' });

/** Ziua calendaristică a României pentru `now`, format `YYYY-MM-DD`. */
function bucharestDate(now: Date): string {
	return bucharestDateFmt.format(now);
}

interface SiteRow {
	id: string;
	tenantId: string;
	name: string;
}

async function purgeOldEvents(now: Date): Promise<number> {
	const cutoff = new Date(now.getTime() - SENTINEL_RETENTION_DAYS * 24 * 60 * 60 * 1000);
	const result = await db
		.delete(table.wordpressSecurityEvent)
		.where(lt(table.wordpressSecurityEvent.occurredAt, cutoff));
	return (result as { rowsAffected?: number })?.rowsAffected ?? 0;
}

/** Golește `pendingFindings` pentru un site, păstrând restul memoriei lungi (`SentinelState`). */
async function clearPendingFindings(siteId: string, now: Date): Promise<void> {
	const [row] = await db
		.select({ sentinelState: table.wordpressSite.sentinelState })
		.from(table.wordpressSite)
		.where(eq(table.wordpressSite.id, siteId));
	if (!row) return;
	const state = parseState(row.sentinelState);
	state.pendingFindings = [];
	await db
		.update(table.wordpressSite)
		.set({ sentinelState: JSON.stringify(state), updatedAt: now })
		.where(eq(table.wordpressSite.id, siteId));
}

export interface WordpressSentinelDailyResult {
	success: true;
	tenants: number;
	pulled: number;
	sent: number;
	deleted?: number;
}

export async function processWordpressSentinelDaily(
	_params: Record<string, unknown> = {},
	now: Date = new Date()
): Promise<WordpressSentinelDailyResult> {
	const sites = (await db
		.select({
			id: table.wordpressSite.id,
			tenantId: table.wordpressSite.tenantId,
			name: table.wordpressSite.name
		})
		.from(table.wordpressSite)
		.where(eq(table.wordpressSite.paused, 0))) as SiteRow[];

	const byTenant = new Map<string, SiteRow[]>();
	for (const site of sites) {
		const list = byTenant.get(site.tenantId) ?? [];
		list.push(site);
		byTenant.set(site.tenantId, list);
	}

	let pulled = 0;
	let sent = 0;

	if (byTenant.size > 0) {
		const tenantIds = [...byTenant.keys()];
		const tenantRows = (await db
			.select({ id: table.tenant.id, slug: table.tenant.slug })
			.from(table.tenant)
			.where(inArray(table.tenant.id, tenantIds))) as { id: string; slug: string }[];
		const slugByTenantId = new Map(tenantRows.map((t) => [t.id, t.slug]));

		const dateStr = bucharestDate(now);
		const redis = getRedis();

		for (const [tenantId, tenantSites] of byTenant) {
			const pulls: { site: SiteRow; result: PullResult }[] = [];
			for (const site of tenantSites) {
				let result: PullResult;
				try {
					result = await pullSite(site.id, { now, trigger: 'daily' });
				} catch (err) {
					const { message } = serializeError(err);
					logWarning('wordpress', `Sentinel daily: pullSite a aruncat pentru ${site.name}: ${message}`, {
						tenantId,
						metadata: { siteId: site.id }
					});
					result = {
						siteId: site.id,
						siteName: site.name,
						status: 'error',
						inserted: 0,
						findings: [],
						pending: [],
						failures: 1,
						error: message
					};
				}
				pulled++;
				pulls.push({ site, result });
			}

			const digestSites: DigestSite[] = [];
			const sitesToClear: SiteRow[] = [];
			let quietSites = 0;
			let withFindings = 0;

			for (const { site, result } of pulls) {
				if (result.status === 'unsupported') continue;

				const findings: Finding[] = [...result.pending];
				if (result.status === 'error') {
					findings.push(
						result.failures >= 2
							? { level: 'critical', kind: 'pull_failed', text: `nu răspunde de ${result.failures} zile` }
							: { level: 'important', kind: 'pull_failed', text: 'nu răspunde (prima zi)' }
					);
				}

				if (findings.length === 0) {
					quietSites++;
					continue;
				}

				withFindings++;
				digestSites.push({ name: site.name, findings });
				if (result.pending.length > 0) sitesToClear.push(site);
			}

			const key = `sentinel:digest:${tenantId}:${dateStr}`;
			const alreadySent = await redis.get(key);
			if (alreadySent) {
				logInfo('wordpress', `Sentinel daily: tenant ${tenantId} — digest deja trimis azi, skip`, {
					tenantId,
					metadata: { withFindings, quietSites }
				});
				continue;
			}

			const tenantSlug = slugByTenantId.get(tenantId) ?? tenantId;
			const url = `${getAppBaseUrl()}/${tenantSlug}/wordpress/security`;
			const messages = buildDigest({ date: now, sites: digestSites, quietSites, url });

			const users = await db
				.select({ userId: table.tenantUser.userId })
				.from(table.tenantUser)
				.where(eq(table.tenantUser.tenantId, tenantId));

			let delivered = 0;
			for (const u of users) {
				try {
					let allOk = true;
					for (const text of messages) {
						const res = await sendTelegramMessage({ tenantId, userId: u.userId, text });
						if (!res.ok) allOk = false;
					}
					if (allOk) delivered++;
				} catch (err) {
					logWarning(
						'wordpress',
						`Sentinel daily: trimitere Telegram a aruncat pentru user ${u.userId}: ${serializeError(err).message}`,
						{ tenantId }
					);
				}
			}

			if (delivered > 0) {
				sent++;
				await redis.set(key, '1', 'EX', DIGEST_KEY_TTL_SEC, 'NX');
				for (const site of sitesToClear) {
					await clearPendingFindings(site.id, now);
				}
			}

			logInfo(
				'wordpress',
				`Sentinel daily: tenant ${tenantId} — ${tenantSites.length} site-uri, ${withFindings} cu findings, ${quietSites} liniștite, ${delivered}/${users.length} utilizatori notificați`,
				{ tenantId, metadata: { withFindings, quietSites, delivered, users: users.length } }
			);
		}
	}

	const deleted = await purgeOldEvents(now);

	return { success: true, tenants: byTenant.size, pulled, sent, deleted };
}
