// Remote functions pentru modulul PageSpeed Insights (SEO Links → PageSpeed).
// Toate citirile și mutațiile sunt scop-uite pe tenantul din sesiune și cer staff.
// Notă: spec-ul inițial cerea REST /api/pagespeed/*; standardul proiectului este
// query()/command() — funcționalitatea este echivalentă (vezi planul din docs/).
import { query, command, getRequestEvent } from '$app/server';
import { error } from '@sveltejs/kit';
import * as v from 'valibot';
import { and, desc, eq } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { requireStaff } from '$lib/server/get-actor';
// import static, NU dinamic: rolldown (Vite 8) compilează `await import(...)` din
// fișierele .remote.ts în `await void 0` → funcția pică pe build-ul de producție
import { buildPagespeedSites } from '$lib/server/pagespeed/sites-data';
import { getRedis } from '$lib/server/redis';
import { getScanProgress, isScanActive } from '$lib/server/pagespeed/scan';
import { getSchedulerQueue } from '$lib/server/scheduler';
import { PSI_HOURS, isoWeekKey, type PsiStrategy } from '$lib/logic/pagespeed';

function generateId() {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

function requireTenantEvent() {
	const event = getRequestEvent();
	const tenant = event?.locals.tenant;
	if (!event?.locals.user || !tenant) {
		throw error(401, 'Unauthorized');
	}
	return { event, tenantId: tenant.id };
}

export type { PagespeedStrategyData } from '$lib/server/pagespeed/sites-data';

/** Site-urile tenantului + ultimele măsurători pe fiecare strategie. */
export const getPagespeedSites = query(async () => {
	const { event, tenantId } = requireTenantEvent();
	await requireStaff(event);
	// logica partajată cu pagina PageSpeed din portalul clientului
	return buildPagespeedSites(tenantId);
});

/** Istoricul complet al unui site (pentru drawer): măsurători pe ambele strategii. */
export const getPagespeedSiteHistory = query(v.pipe(v.string(), v.minLength(1)), async (siteId) => {
	const { event, tenantId } = requireTenantEvent();
	await requireStaff(event);

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
	const { event, tenantId } = requireTenantEvent();
	await requireStaff(event);

	const [row] = await db
		.select()
		.from(table.pagespeedSettings)
		.where(eq(table.pagespeedSettings.tenantId, tenantId))
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
	const { event, tenantId } = requireTenantEvent();
	await requireStaff(event);
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
	const { event, tenantId } = requireTenantEvent();
	await requireStaff(event);
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
	const { event, tenantId } = requireTenantEvent();
	await requireStaff(event);

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
	const { event, tenantId } = requireTenantEvent();
	await requireStaff(event);

	const rows = await db
		.select()
		.from(table.pagespeedReport)
		.where(eq(table.pagespeedReport.tenantId, tenantId))
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
		const { event, tenantId } = requireTenantEvent();
		await requireStaff(event);
	
		// o scanare al cărei proces a murit NU mai blochează relansarea (isScanActive
		// verifică heartbeat-ul, nu doar absența lui finishedAt)
		if (isScanActive(await getScanProgress(tenantId))) {
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

/**
 * Starea scanării curente (null când nu s-a rulat nimic recent). `state` spune
 * UI-ului adevărul: `running` = în curs, `done` = terminată, `dead` = procesul a
 * murit la mijloc (altfel bannerul ar rămâne agățat până expiră cheia Redis).
 */
export const getPagespeedScanStatus = query(async () => {
	const { event, tenantId } = requireTenantEvent();
	await requireStaff(event);
	const progress = await getScanProgress(tenantId);
	if (!progress) return null;
	const state: 'running' | 'done' | 'dead' = progress.finishedAt
		? 'done'
		: isScanActive(progress)
			? 'running'
			: 'dead';
	return { ...progress, state };
});

/**
 * Trimite raportul săptămânii curente ACUM, către destinatarii din setări
 * (butonul „Trimite acum" din previzualizare). Actualizează/creează rândul
 * de raport al săptămânii cu nota „trimis manual".
 */
export const sendPagespeedReportNow = command(async () => {
	const { event, tenantId } = requireTenantEvent();
	await requireStaff(event);

	// două taburi (sau două click-uri) NU trebuie să trimită raportul de două ori
	const redis = getRedis();
	const lockKey = `${tenantId}:pagespeed:report-send`;
	// SET … NX EX e atomic: fără TOCTOU între o citire și o scriere separate
	const acquired = await redis.set(lockKey, '1', 'EX', 180, 'NX');
	if (!acquired) {
		throw error(409, 'Raportul este deja în curs de trimitere');
	}
	try {
		return await sendReportNow(tenantId);
	} finally {
		await redis.del(lockKey).catch(() => {});
	}
});

async function sendReportNow(tenantId: string) {
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
}

/** Datele raportului curent, pentru modalul de previzualizare din UI. */
export const getPagespeedReportPreview = query(
	// opțional: o săptămână istorică („2026-W35") — altfel săptămâna curentă
	v.optional(v.pipe(v.string(), v.regex(/^\d{4}-W\d{2}$/))),
	async (weekKey) => {
		const { event, tenantId } = requireTenantEvent();
		await requireStaff(event);

		// „YYYY-Www" se compară lexicografic corect cronologic; o săptămână viitoare
		// ar întoarce un raport gol, care arată ca o eroare de date
		const currentWeek = isoWeekKey(new Date());
		if (weekKey && weekKey > currentWeek) {
			throw error(400, 'Nu există încă date pentru o săptămână viitoare');
		}

		const [settings] = await db
			.select()
			.from(table.pagespeedSettings)
			.where(eq(table.pagespeedSettings.tenantId, tenantId))
			.limit(1);
		const { buildPagespeedReportData } = await import('$lib/server/pagespeed/report');
		return buildPagespeedReportData(tenantId, weekKey ?? currentWeek, {
			includeOpportunities: settings?.includeOpportunities ?? true,
			attachPdf: settings?.attachPdf ?? false
		});
	}
);

/** Clienții tenantului, pentru dropdown-ul din modalul de site. */
export const getPagespeedClients = query(async () => {
	const { event, tenantId } = requireTenantEvent();
	await requireStaff(event);
	return db
		.select({ id: table.client.id, name: table.client.name })
		.from(table.client)
		.where(eq(table.client.tenantId, tenantId))
		.orderBy(table.client.name);
});
