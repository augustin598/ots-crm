// Remote functions pentru modulul PageSpeed Insights (SEO Links → PageSpeed).
// Toate citirile și mutațiile sunt scop-uite pe tenantul din sesiune și cer staff.
// Notă: spec-ul inițial cerea REST /api/pagespeed/*; standardul proiectului este
// query()/command() — funcționalitatea este echivalentă (vezi planul din docs/).
import { query, command, getRequestEvent } from '$app/server';
import { error } from '@sveltejs/kit';
import * as v from 'valibot';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { requireStaff } from '$lib/server/get-actor';
import { getScanProgress } from '$lib/server/pagespeed/scan';
import { getSchedulerQueue } from '$lib/server/scheduler';
import { cwvPass, PSI_HOURS, type PsiStrategy } from '$lib/logic/pagespeed';

const SPARK_POINTS = 10;

function generateId() {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

function requireTenantEvent() {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw error(401, 'Unauthorized');
	}
	return event;
}

type MeasurementRow = typeof table.pagespeedMeasurement.$inferSelect;

export interface PagespeedStrategyData {
	last: MeasurementRow | null;
	prev: MeasurementRow | null;
	/** Trendul din spec: diferența față de măsurătoarea anterioară, același site + strategie. */
	delta: number | null;
	spark: number[];
}

/** Site-urile tenantului + ultimele măsurători pe fiecare strategie. */
export const getPagespeedSites = query(async () => {
	const event = requireTenantEvent();
	await requireStaff(event);
	const tenantId = event.locals.tenant.id;

	const sites = await db
		.select({
			id: table.pagespeedSite.id,
			clientId: table.pagespeedSite.clientId,
			clientName: table.client.name,
			domain: table.pagespeedSite.domain,
			name: table.pagespeedSite.name,
			cms: table.pagespeedSite.cms,
			pages: table.pagespeedSite.pages,
			strategies: table.pagespeedSite.strategies,
			alertThreshold: table.pagespeedSite.alertThreshold,
			active: table.pagespeedSite.active,
			pausedAt: table.pagespeedSite.pausedAt,
			createdAt: table.pagespeedSite.createdAt
		})
		.from(table.pagespeedSite)
		.leftJoin(
			table.client,
			and(
				eq(table.pagespeedSite.clientId, table.client.id),
				eq(table.client.tenantId, tenantId)
			)
		)
		.where(eq(table.pagespeedSite.tenantId, tenantId))
		.orderBy(table.pagespeedSite.domain);

	const siteIds = sites.map((s) => s.id);
	const measurements: MeasurementRow[] = siteIds.length
		? await db
				.select()
				.from(table.pagespeedMeasurement)
				.where(inArray(table.pagespeedMeasurement.siteId, siteIds))
				.orderBy(desc(table.pagespeedMeasurement.measuredAt))
		: [];

	// grupăm în JS: pe (site, strategie), în ordine descrescătoare a timpului
	const bySiteStrategy = new Map<string, MeasurementRow[]>();
	for (const m of measurements) {
		const key = `${m.siteId}:${m.strategy}`;
		const list = bySiteStrategy.get(key) ?? [];
		if (list.length < SPARK_POINTS + 2) list.push(m);
		bySiteStrategy.set(key, list);
	}

	let lastScanAt: Date | null = null;
	for (const m of measurements) {
		if (!lastScanAt || m.measuredAt > lastScanAt) lastScanAt = m.measuredAt;
	}

	const strategyData = (siteId: string, strategy: PsiStrategy): PagespeedStrategyData => {
		const rows = bySiteStrategy.get(`${siteId}:${strategy}`) ?? [];
		const ok = rows.filter((r) => r.status === 'ok');
		const last = rows[0] ?? null; // include eventualul failed, ca UI să-l poată semnala
		const lastOk = ok[0] ?? null;
		const prevOk = ok[1] ?? null;
		return {
			last,
			prev: prevOk,
			delta:
				lastOk?.performance != null && prevOk?.performance != null
					? lastOk.performance - prevOk.performance
					: null,
			spark: ok
				.slice(0, SPARK_POINTS)
				.map((r) => r.performance)
				.filter((p): p is number => p != null)
				.reverse()
		};
	};

	return {
		lastScanAt,
		sites: sites.map((s) => {
			const mobile = strategyData(s.id, 'mobile');
			const lastOkMobile = mobile.last?.status === 'ok' ? mobile.last : mobile.prev;
			return {
				...s,
				pages: s.pages as { url: string; label: string }[],
				strategies: s.strategies as PsiStrategy[],
				data: {
					mobile,
					desktop: strategyData(s.id, 'desktop')
				},
				cwv: cwvPass(
					lastOkMobile
						? {
								lcpMs: lastOkMobile.fieldLcpMs,
								inpMs: lastOkMobile.fieldInpMs,
								cls: lastOkMobile.fieldCls
							}
						: null
				)
			};
		})
	};
});

/** Istoricul complet al unui site (pentru drawer): măsurători pe ambele strategii. */
export const getPagespeedSiteHistory = query(v.pipe(v.string(), v.minLength(1)), async (siteId) => {
	const event = requireTenantEvent();
	await requireStaff(event);
	const tenantId = event.locals.tenant.id;

	const [site] = await db
		.select()
		.from(table.pagespeedSite)
		.where(and(eq(table.pagespeedSite.id, siteId), eq(table.pagespeedSite.tenantId, tenantId)))
		.limit(1);
	if (!site) throw error(404, 'Site-ul nu a fost găsit');

	const rows = await db
		.select()
		.from(table.pagespeedMeasurement)
		.where(eq(table.pagespeedMeasurement.siteId, siteId))
		.orderBy(desc(table.pagespeedMeasurement.measuredAt))
		.limit(60);

	const split = (strategy: PsiStrategy) =>
		rows.filter((r) => r.strategy === strategy).slice(0, 12).reverse();

	return {
		site: {
			...site,
			pages: site.pages as { url: string; label: string }[],
			strategies: site.strategies as PsiStrategy[]
		},
		mobile: split('mobile'),
		desktop: split('desktop')
	};
});

const DEFAULT_SETTINGS = {
	dayOfWeek: 1,
	hour: '07:00',
	strategies: ['mobile', 'desktop'] as PsiStrategy[],
	recipients: [] as string[],
	alertThreshold: 5,
	onlyOnDrop: false,
	includeOpportunities: true,
	attachPdf: false,
	sendToClient: false,
	isEnabled: true
};

/** Setările raportului săptămânal (sau default-urile, dacă nu s-au salvat încă). */
export const getPagespeedSettings = query(async () => {
	const event = requireTenantEvent();
	await requireStaff(event);

	const [row] = await db
		.select()
		.from(table.pagespeedSettings)
		.where(eq(table.pagespeedSettings.tenantId, event.locals.tenant.id))
		.limit(1);

	if (!row) return { ...DEFAULT_SETTINGS, saved: false };
	return {
		dayOfWeek: row.dayOfWeek,
		hour: row.hour,
		strategies: row.strategies as PsiStrategy[],
		recipients: row.recipients as string[],
		alertThreshold: row.alertThreshold,
		onlyOnDrop: row.onlyOnDrop,
		includeOpportunities: row.includeOpportunities,
		attachPdf: row.attachPdf,
		sendToClient: row.sendToClient,
		isEnabled: row.isEnabled,
		saved: true
	};
});

const settingsSchema = v.object({
	dayOfWeek: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(7)),
	hour: v.picklist(PSI_HOURS),
	strategies: v.pipe(v.array(v.picklist(['mobile', 'desktop'])), v.minLength(1)),
	recipients: v.array(v.pipe(v.string(), v.trim(), v.email())),
	alertThreshold: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(50)),
	onlyOnDrop: v.boolean(),
	includeOpportunities: v.boolean(),
	attachPdf: v.boolean(),
	sendToClient: v.boolean(),
	isEnabled: v.optional(v.boolean(), true)
});

export const savePagespeedSettings = command(settingsSchema, async (params) => {
	const event = requireTenantEvent();
	await requireStaff(event);
	const tenantId = event.locals.tenant.id;
	const now = new Date();

	const [existing] = await db
		.select({ id: table.pagespeedSettings.id })
		.from(table.pagespeedSettings)
		.where(eq(table.pagespeedSettings.tenantId, tenantId))
		.limit(1);

	const data = {
		dayOfWeek: params.dayOfWeek,
		hour: params.hour,
		strategies: params.strategies,
		recipients: params.recipients,
		alertThreshold: params.alertThreshold,
		onlyOnDrop: params.onlyOnDrop,
		includeOpportunities: params.includeOpportunities,
		attachPdf: params.attachPdf,
		sendToClient: params.sendToClient,
		isEnabled: params.isEnabled ?? true,
		updatedAt: now
	};

	if (existing) {
		await db
			.update(table.pagespeedSettings)
			.set(data)
			.where(
				and(
					eq(table.pagespeedSettings.id, existing.id),
					eq(table.pagespeedSettings.tenantId, tenantId)
				)
			);
		return { id: existing.id, created: false };
	}
	const id = generateId();
	await db.insert(table.pagespeedSettings).values({ id, tenantId, ...data, createdAt: now });
	return { id, created: true };
});

const pageSchema = v.object({
	url: v.pipe(v.string(), v.trim(), v.minLength(1)),
	label: v.pipe(v.string(), v.trim(), v.minLength(1))
});

const siteSchema = v.object({
	id: v.optional(v.pipe(v.string(), v.minLength(1))),
	name: v.pipe(v.string(), v.trim()),
	clientId: v.nullable(v.pipe(v.string(), v.minLength(1))),
	cms: v.pipe(v.string(), v.trim(), v.minLength(1)),
	alertThreshold: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(50)),
	active: v.boolean(),
	strategies: v.pipe(v.array(v.picklist(['mobile', 'desktop'])), v.minLength(1)),
	pages: v.pipe(v.array(pageSchema), v.minLength(1))
});

function normalizeUrl(raw: string): string {
	let value = raw.trim();
	if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		throw error(400, `URL invalid: „${raw}". Exemplu: https://exemplu.ro/`);
	}
	if (!parsed.hostname.includes('.')) {
		throw error(400, `URL invalid: „${raw}". Exemplu: https://exemplu.ro/`);
	}
	return parsed.toString();
}

export const savePagespeedSite = command(siteSchema, async (params) => {
	const event = requireTenantEvent();
	await requireStaff(event);
	const tenantId = event.locals.tenant.id;
	const now = new Date();

	const pages = params.pages.map((p) => ({ url: normalizeUrl(p.url), label: p.label || 'Pagină' }));
	const host = new URL(pages[0].url).hostname.replace(/^www\./, '');

	// verifică apartenența clientului la tenant (dacă e setat)
	if (params.clientId) {
		const [client] = await db
			.select({ id: table.client.id })
			.from(table.client)
			.where(and(eq(table.client.id, params.clientId), eq(table.client.tenantId, tenantId)))
			.limit(1);
		if (!client) throw error(404, 'Clientul nu a fost găsit');
	}

	const data = {
		clientId: params.clientId,
		domain: host,
		name: params.name.trim() || host,
		cms: params.cms,
		pages,
		strategies: params.strategies,
		alertThreshold: params.alertThreshold,
		active: params.active,
		pausedAt: params.active ? null : now,
		updatedAt: now
	};

	if (params.id) {
		const [existing] = await db
			.select({ id: table.pagespeedSite.id })
			.from(table.pagespeedSite)
			.where(and(eq(table.pagespeedSite.id, params.id), eq(table.pagespeedSite.tenantId, tenantId)))
			.limit(1);
		if (!existing) throw error(404, 'Site-ul nu a fost găsit');
		await db
			.update(table.pagespeedSite)
			.set(data)
			.where(
				and(eq(table.pagespeedSite.id, params.id), eq(table.pagespeedSite.tenantId, tenantId))
			);
		return { id: params.id, created: false };
	}

	const id = generateId();
	await db.insert(table.pagespeedSite).values({ id, tenantId, ...data, createdAt: now });
	return { id, created: true };
});

export const deletePagespeedSite = command(v.pipe(v.string(), v.minLength(1)), async (siteId) => {
	const event = requireTenantEvent();
	await requireStaff(event);
	const tenantId = event.locals.tenant.id;

	const [existing] = await db
		.select({ id: table.pagespeedSite.id })
		.from(table.pagespeedSite)
		.where(and(eq(table.pagespeedSite.id, siteId), eq(table.pagespeedSite.tenantId, tenantId)))
		.limit(1);
	if (!existing) throw error(404, 'Site-ul nu a fost găsit');

	// măsurătorile cad prin ON DELETE CASCADE
	await db
		.delete(table.pagespeedSite)
		.where(and(eq(table.pagespeedSite.id, siteId), eq(table.pagespeedSite.tenantId, tenantId)));
	return { deleted: true };
});

/** Istoricul rapoartelor săptămânale trimise. */
export const getPagespeedReports = query(async () => {
	const event = requireTenantEvent();
	await requireStaff(event);

	const rows = await db
		.select()
		.from(table.pagespeedReport)
		.where(eq(table.pagespeedReport.tenantId, event.locals.tenant.id))
		.orderBy(desc(table.pagespeedReport.weekKey))
		.limit(12);

	return rows.map((r) => ({ ...r, recipients: r.recipients as string[] }));
});

/**
 * Pornește o scanare manuală (toate site-urile active sau doar `siteIds`).
 * Rulează asincron prin coadă; progresul se citește cu getPagespeedScanStatus.
 */
export const startPagespeedScan = command(
	v.optional(v.array(v.pipe(v.string(), v.minLength(1)))),
	async (siteIds) => {
		const event = requireTenantEvent();
		await requireStaff(event);
		const tenantId = event.locals.tenant.id;

		const active = await getScanProgress(tenantId);
		if (active && !active.finishedAt) {
			throw error(409, 'O scanare este deja în curs pentru acest cont');
		}

		await getSchedulerQueue().add(
			'pagespeed-scan',
			{ type: 'pagespeed_scan', params: { tenantId, siteIds: siteIds ?? null } },
			{ jobId: `pagespeed-scan-${tenantId}-${Date.now()}`, attempts: 1, removeOnComplete: true, removeOnFail: true }
		);
		return { started: true };
	}
);

/** Starea scanării curente (null când nu rulează nimic). */
export const getPagespeedScanStatus = query(async () => {
	const event = requireTenantEvent();
	await requireStaff(event);
	return getScanProgress(event.locals.tenant.id);
});

/**
 * Trimite raportul săptămânii curente ACUM, către destinatarii din setări
 * (butonul „Trimite acum" din previzualizare). Actualizează/creează rândul
 * de raport al săptămânii cu nota „trimis manual".
 */
export const sendPagespeedReportNow = command(async () => {
	const event = requireTenantEvent();
	await requireStaff(event);
	const tenantId = event.locals.tenant.id;

	const [settings] = await db
		.select()
		.from(table.pagespeedSettings)
		.where(eq(table.pagespeedSettings.tenantId, tenantId))
		.limit(1);
	const recipients = (settings?.recipients as string[] | undefined) ?? [];
	if (!recipients.length) {
		throw error(400, 'Niciun destinatar configurat — adaugă destinatari în Setări raport');
	}

	const { buildPagespeedReportData } = await import('$lib/server/pagespeed/report');
	const { sendPagespeedReportEmail } = await import('$lib/server/email');
	const { isoWeekKey } = await import('$lib/logic/pagespeed');

	const now = new Date();
	const weekKey = isoWeekKey(now);
	const data = await buildPagespeedReportData(tenantId, weekKey, {
		includeOpportunities: settings?.includeOpportunities ?? true,
		attachPdf: settings?.attachPdf ?? false
	});
	const threshold = settings?.alertThreshold ?? 5;

	let failed = 0;
	for (const recipient of recipients) {
		try {
			await sendPagespeedReportEmail(tenantId, recipient, data, threshold);
		} catch {
			failed++;
		}
	}

	const reportValues = {
		sentAt: now,
		siteCount: data.siteCount,
		avgMobile: data.avgMobile,
		avgDesktop: data.avgDesktop,
		deltaMobile: data.deltaMobile,
		alertCount: data.alertCount,
		status: (failed > 0 ? 'partial' : 'sent') as 'partial' | 'sent',
		note: failed > 0 ? `trimis manual · ${failed} emailuri eșuate` : 'trimis manual',
		recipients
	};
	const [existingReport] = await db
		.select({ id: table.pagespeedReport.id })
		.from(table.pagespeedReport)
		.where(
			and(
				eq(table.pagespeedReport.tenantId, tenantId),
				eq(table.pagespeedReport.weekKey, weekKey)
			)
		)
		.limit(1);
	if (existingReport) {
		await db
			.update(table.pagespeedReport)
			.set(reportValues)
			.where(
				and(
					eq(table.pagespeedReport.id, existingReport.id),
					eq(table.pagespeedReport.tenantId, tenantId)
				)
			);
	} else {
		await db.insert(table.pagespeedReport).values({
			id: generateId(),
			tenantId,
			weekKey,
			...reportValues,
			createdAt: now
		});
	}
	return { sent: recipients.length - failed, failed };
});

/** Datele raportului curent, pentru modalul de previzualizare din UI. */
export const getPagespeedReportPreview = query(async () => {
	const event = requireTenantEvent();
	await requireStaff(event);
	const tenantId = event.locals.tenant.id;

	const [settings] = await db
		.select()
		.from(table.pagespeedSettings)
		.where(eq(table.pagespeedSettings.tenantId, tenantId))
		.limit(1);
	const { buildPagespeedReportData } = await import('$lib/server/pagespeed/report');
	const { isoWeekKey } = await import('$lib/logic/pagespeed');
	return buildPagespeedReportData(tenantId, isoWeekKey(new Date()), {
		includeOpportunities: settings?.includeOpportunities ?? true,
		attachPdf: settings?.attachPdf ?? false
	});
});

/** Clienții tenantului, pentru dropdown-ul din modalul de site. */
export const getPagespeedClients = query(async () => {
	const event = requireTenantEvent();
	await requireStaff(event);
	return db
		.select({ id: table.client.id, name: table.client.name })
		.from(table.client)
		.where(eq(table.client.tenantId, event.locals.tenant.id))
		.orderBy(table.client.name);
});
