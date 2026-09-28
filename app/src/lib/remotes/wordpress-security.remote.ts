import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, desc, eq, gte, like, lt, or, sql } from 'drizzle-orm';
import { requireStaff } from '$lib/server/get-actor';
import { pullSite, supportsSentinel } from '$lib/server/wordpress/sentinel/pull';
import { parseState } from '$lib/server/wordpress/sentinel/types';

const PAGE = 100;
const PERIOD_DAYS = { '24h': 1, '7d': 7 } as const; // evenimentele se țin 7 zile

async function staffTenantId(): Promise<string> {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
	await requireStaff(event);
	return event.locals.tenant.id;
}

/** Carduri per site: starea ultimei citiri + contoare pe 7 zile. */
export const getSecurityOverview = query(async () => {
	const tenantId = await staffTenantId();
	const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
	const sites = await db
		.select({
			id: table.wordpressSite.id,
			name: table.wordpressSite.name,
			siteUrl: table.wordpressSite.siteUrl,
			paused: table.wordpressSite.paused,
			connectorVersion: table.wordpressSite.connectorVersion,
			lastPullAt: table.wordpressSite.sentinelLastPullAt,
			lastPullStatus: table.wordpressSite.sentinelLastPullStatus,
			failures: table.wordpressSite.sentinelFailures,
			state: table.wordpressSite.sentinelState
		})
		.from(table.wordpressSite)
		.where(eq(table.wordpressSite.tenantId, tenantId))
		.orderBy(table.wordpressSite.name);

	const counts = await db
		.select({
			siteId: table.wordpressSecurityEvent.siteId,
			critical: sql<number>`sum(case when ${table.wordpressSecurityEvent.level} = 'critical' then 1 else 0 end)`,
			important: sql<number>`sum(case when ${table.wordpressSecurityEvent.level} = 'important' then 1 else 0 end)`,
			failedLogins: sql<number>`sum(case when ${table.wordpressSecurityEvent.event} = 'login_esuat' then 1 else 0 end)`,
			adminLogins: sql<number>`sum(case when ${table.wordpressSecurityEvent.event} = 'login_ok' and ${table.wordpressSecurityEvent.sentinelSev} = 'WARN' then 1 else 0 end)`
		})
		.from(table.wordpressSecurityEvent)
		.where(
			and(
				eq(table.wordpressSecurityEvent.tenantId, tenantId),
				gte(table.wordpressSecurityEvent.occurredAt, since7d)
			)
		)
		.groupBy(table.wordpressSecurityEvent.siteId);
	const bySite = new Map(counts.map((c) => [c.siteId, c]));

	return sites.map((s) => {
		const c = bySite.get(s.id);
		const st = parseState(s.state);
		return {
			id: s.id,
			name: s.name,
			siteUrl: s.siteUrl,
			paused: s.paused === 1,
			connectorVersion: s.connectorVersion,
			status: (!supportsSentinel(s.connectorVersion)
				? 'unsupported'
				: (s.lastPullStatus ?? 'never')) as 'ok' | 'legacy' | 'error' | 'unsupported' | 'never',
			lastPullAt: s.lastPullAt ? s.lastPullAt.toISOString() : null,
			failures: s.failures,
			lastError: st.lastError,
			pendingCount: st.pendingFindings.length,
			counts7d: {
				critical: Number(c?.critical ?? 0),
				important: Number(c?.important ?? 0),
				failedLogins: Number(c?.failedLogins ?? 0),
				adminLogins: Number(c?.adminLogins ?? 0)
			}
		};
	});
});

const EventsArgs = v.object({
	siteId: v.optional(v.string()),
	level: v.optional(v.picklist(['critical', 'important', 'normal'])),
	event: v.optional(v.pipe(v.string(), v.maxLength(64))),
	period: v.optional(v.picklist(['24h', '7d'])),
	q: v.optional(v.pipe(v.string(), v.maxLength(100))),
	cursor: v.optional(v.string()) // occurredAt ISO al ultimului rând din pagina anterioară
});

/**
 * Evenimente filtrate, cele mai noi primele, 100/pagină cu cursor pe occurredAt.
 * Limitare cunoscută: cursorul pe `occurredAt` singur poate sări rânduri cu
 * exact același timestamp la granița dintre pagini — acceptabil pentru o
 * vizualizare de audit de 100 rânduri/pagină.
 */
export const getSecurityEvents = query(EventsArgs, async (args) => {
	const tenantId = await staffTenantId();
	const since = new Date(Date.now() - PERIOD_DAYS[args.period ?? '7d'] * 24 * 60 * 60 * 1000);
	const where = [
		eq(table.wordpressSecurityEvent.tenantId, tenantId),
		gte(table.wordpressSecurityEvent.occurredAt, since)
	];
	if (args.siteId) where.push(eq(table.wordpressSecurityEvent.siteId, args.siteId));
	if (args.level) where.push(eq(table.wordpressSecurityEvent.level, args.level));
	if (args.event) where.push(eq(table.wordpressSecurityEvent.event, args.event));
	const needle = args.q?.trim();
	if (needle) {
		// `needle` poate conține wildcard-urile LIKE (%/_) venite de la utilizator —
		// inofensiv aici (doar staff, scopat pe tenant).
		const cond = or(
			like(table.wordpressSecurityEvent.ip, `%${needle}%`),
			like(table.wordpressSecurityEvent.username, `%${needle}%`)
		);
		if (cond) where.push(cond);
	}
	if (args.cursor) {
		const c = new Date(args.cursor);
		if (!Number.isNaN(c.getTime())) where.push(lt(table.wordpressSecurityEvent.occurredAt, c));
	}

	const rows = await db
		.select({
			id: table.wordpressSecurityEvent.id,
			siteId: table.wordpressSecurityEvent.siteId,
			siteName: table.wordpressSite.name,
			occurredAt: table.wordpressSecurityEvent.occurredAt,
			level: table.wordpressSecurityEvent.level,
			event: table.wordpressSecurityEvent.event,
			username: table.wordpressSecurityEvent.username,
			ip: table.wordpressSecurityEvent.ip,
			uri: table.wordpressSecurityEvent.uri,
			userAgent: table.wordpressSecurityEvent.userAgent,
			data: table.wordpressSecurityEvent.data
		})
		.from(table.wordpressSecurityEvent)
		.innerJoin(table.wordpressSite, eq(table.wordpressSite.id, table.wordpressSecurityEvent.siteId))
		.where(and(...where))
		.orderBy(desc(table.wordpressSecurityEvent.occurredAt))
		.limit(PAGE + 1);

	const hasMore = rows.length > PAGE;
	const page = rows.slice(0, PAGE).map((r) => ({ ...r, occurredAt: r.occurredAt.toISOString() }));
	return { rows: page, nextCursor: hasMore ? page[page.length - 1].occurredAt : null };
});

/** „Citește acum” pentru un site — fără Telegram; findings-urile intră în digest-ul de mâine. */
export const pullSiteNow = command(v.object({ siteId: v.string() }), async ({ siteId }) => {
	const tenantId = await staffTenantId();
	const [site] = await db
		.select({ id: table.wordpressSite.id })
		.from(table.wordpressSite)
		.where(and(eq(table.wordpressSite.id, siteId), eq(table.wordpressSite.tenantId, tenantId)))
		.limit(1);
	if (!site) throw new Error('Site inexistent');
	const r = await pullSite(site.id, { trigger: 'manual' });
	return {
		status: r.status,
		inserted: r.inserted,
		findings: r.findings,
		error: r.error ?? null,
		scan: r.scan ?? null
	};
});
