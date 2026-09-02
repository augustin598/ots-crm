// Remote functions pentru modulul Rank Tracker (poziții Google organic).
// Standard proiect: query()/command() din $app/server, requireStaff + scoping pe
// tenantul din sesiune. Credențialele SERP nu sunt NICIODATĂ returnate clientului.
import { query, command, getRequestEvent } from '$app/server';
import { error } from '@sveltejs/kit';
import * as v from 'valibot';
import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { requireStaff } from '$lib/server/get-actor';
import { getSchedulerQueue } from '$lib/server/scheduler';
import { RANK_HOURS, normalizeKeyword } from '$lib/logic/rank-tracker';
import { buildRankProjects, buildRankProjectDetail } from '$lib/server/rank-tracker/projects-data';
import { getRankRunProgress, rankRunProgressKey } from '$lib/server/rank-tracker/run';
import { getRedis } from '$lib/server/redis';

const MAX_KEYWORDS = Number(env.RANK_MAX_KEYWORDS_PER_PROJECT ?? 500) || 500;

function generateId() {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

function requireTenantEvent() {
	const event = getRequestEvent();
	const tenant = event?.locals.tenant;
	if (!event?.locals.user || !tenant) throw error(401, 'Unauthorized');
	return { event, tenantId: tenant.id, userId: event.locals.user.id as string };
}

function normalizeDomain(input: string): string {
	return input
		.trim()
		.replace(/^https?:\/\//i, '')
		.replace(/^www\./i, '')
		.replace(/\/.*$/, '')
		.toLowerCase();
}

// ── Citiri ─────────────────────────────────────────────────────────────
export type { RankProjectListRow, RankProjectDetailData, RankKeywordDetail } from '$lib/server/rank-tracker/projects-data';

export const getRankProjects = query(async () => {
	const { event, tenantId } = requireTenantEvent();
	await requireStaff(event);
	return buildRankProjects(tenantId);
});

export const getRankProjectDetail = query(v.pipe(v.string(), v.minLength(1)), async (projectId) => {
	const { event, tenantId } = requireTenantEvent();
	await requireStaff(event);
	const detail = await buildRankProjectDetail(tenantId, projectId);
	if (!detail) throw error(404, 'Proiect inexistent');
	return detail;
});

export const getRankRunStatus = query(v.pipe(v.string(), v.minLength(1)), async (projectId) => {
	const { event, tenantId } = requireTenantEvent();
	await requireStaff(event);
	return getRankRunProgress(tenantId, projectId);
});

/**
 * Progresul agregat al rulărilor din TOATE proiectele active ale tenantului — pentru
 * bara de progres din hub, unde „Verifică acum" pornește câte o rulare per proiect.
 * Citește doar din Redis (cheile de progres), fără atingerea bazei pentru fiecare rulare.
 */
export const getRankRunStatusAll = query(async () => {
	const { event, tenantId } = requireTenantEvent();
	await requireStaff(event);
	const projects = await db
		.select({ id: table.rankProject.id, domain: table.rankProject.domain })
		.from(table.rankProject)
		.where(and(eq(table.rankProject.tenantId, tenantId), eq(table.rankProject.active, true)));

	const progress = await Promise.all(
		projects.map(async (p) => ({ domain: p.domain, run: await getRankRunProgress(tenantId, p.id) }))
	);
	const active = progress.filter((p) => p.run && !p.run.finishedAt);
	return {
		running: active.length,
		projects: active.map((p) => p.domain),
		done: active.reduce((a, p) => a + (p.run?.done ?? 0), 0),
		total: active.reduce((a, p) => a + (p.run?.total ?? 0), 0),
		currentKeyword: active.find((p) => p.run?.currentKeyword)?.run?.currentKeyword ?? null
	};
});

export const getRankReports = query(async () => {
	const { event, tenantId } = requireTenantEvent();
	await requireStaff(event);
	return db
		.select()
		.from(table.rankReport)
		.where(eq(table.rankReport.tenantId, tenantId))
		.orderBy(desc(table.rankReport.weekKey))
		.limit(12);
});

export const getRankAlerts = query(async () => {
	const { event, tenantId } = requireTenantEvent();
	await requireStaff(event);
	return db
		.select({
			id: table.rankAlert.id,
			keyword: table.rankKeyword.keyword,
			device: table.rankAlert.device,
			type: table.rankAlert.type,
			fromPosition: table.rankAlert.fromPosition,
			toPosition: table.rankAlert.toPosition,
			delta: table.rankAlert.delta,
			createdAt: table.rankAlert.createdAt
		})
		.from(table.rankAlert)
		.innerJoin(table.rankKeyword, eq(table.rankAlert.keywordId, table.rankKeyword.id))
		.where(eq(table.rankAlert.tenantId, tenantId))
		.orderBy(desc(table.rankAlert.createdAt))
		.limit(50);
});

export const getRankClients = query(async () => {
	const { event, tenantId } = requireTenantEvent();
	await requireStaff(event);
	return db
		.select({ id: table.client.id, name: table.client.name })
		.from(table.client)
		.where(eq(table.client.tenantId, tenantId))
		.orderBy(table.client.name);
});

// ── Setări ─────────────────────────────────────────────────────────────
const RANK_DEFAULTS = {
	checkHour: '06:00',
	reportDay: 1,
	reportHour: '07:00',
	recipients: [] as string[],
	sendToClient: false,
	attachPdf: true,
	archiveToClient: true,
	alertsEnabled: true,
	providerMode: 'scraper' as const,
	isEnabled: true
};

export const getRankSettings = query(async () => {
	const { event, tenantId } = requireTenantEvent();
	await requireStaff(event);
	const [row] = await db
		.select()
		.from(table.rankSettings)
		.where(eq(table.rankSettings.tenantId, tenantId))
		.limit(1);
	const hasIntegration = !!(
		await db
			.select({ id: table.serpIntegration.id, isActive: table.serpIntegration.isActive })
			.from(table.serpIntegration)
			.where(eq(table.serpIntegration.tenantId, tenantId))
			.limit(1)
	)[0];
	if (!row) return { ...RANK_DEFAULTS, hasIntegration };
	return {
		checkHour: row.checkHour,
		reportDay: row.reportDay,
		reportHour: row.reportHour,
		recipients: row.recipients as string[],
		sendToClient: row.sendToClient,
		attachPdf: row.attachPdf,
		archiveToClient: row.archiveToClient,
		alertsEnabled: row.alertsEnabled,
		providerMode: row.providerMode,
		isEnabled: row.isEnabled,
		hasIntegration
	};
});

const settingsSchema = v.object({
	checkHour: v.picklist(RANK_HOURS),
	reportDay: v.pipe(v.number(), v.minValue(1), v.maxValue(7)),
	reportHour: v.picklist(RANK_HOURS),
	recipients: v.array(v.pipe(v.string(), v.email())),
	sendToClient: v.boolean(),
	attachPdf: v.boolean(),
	archiveToClient: v.boolean(),
	alertsEnabled: v.boolean(),
	providerMode: v.picklist(['scraper', 'dataforseo', 'auto']),
	isEnabled: v.boolean()
});

export const saveRankSettings = command(settingsSchema, async (input) => {
	const { event, tenantId } = requireTenantEvent();
	await requireStaff(event);
	const now = new Date();
	const [existing] = await db
		.select({ id: table.rankSettings.id })
		.from(table.rankSettings)
		.where(eq(table.rankSettings.tenantId, tenantId))
		.limit(1);
	if (existing) {
		await db.update(table.rankSettings).set({ ...input, updatedAt: now }).where(eq(table.rankSettings.id, existing.id));
	} else {
		await db.insert(table.rankSettings).values({ id: generateId(), tenantId, ...input, createdAt: now, updatedAt: now });
	}
	return { ok: true };
});

// ── Proiecte ───────────────────────────────────────────────────────────
const projectSchema = v.object({
	id: v.optional(v.string()),
	name: v.pipe(v.string(), v.minLength(1), v.maxLength(120)),
	clientId: v.nullable(v.string()),
	domain: v.pipe(v.string(), v.minLength(3)),
	locale: v.pipe(v.string(), v.minLength(3)),
	locations: v.pipe(v.array(v.string()), v.maxLength(5)),
	competitors: v.pipe(v.array(v.string()), v.maxLength(10)),
	devices: v.pipe(v.array(v.picklist(['desktop', 'mobile'])), v.minLength(1)),
	alertThreshold: v.pipe(v.number(), v.minValue(1), v.maxValue(50)),
	active: v.boolean()
});

export const saveRankProject = command(projectSchema, async (input) => {
	const { event, tenantId } = requireTenantEvent();
	await requireStaff(event);
	const now = new Date();
	const domain = normalizeDomain(input.domain);
	const competitors = input.competitors.map(normalizeDomain).filter(Boolean);
	const payload = {
		name: input.name,
		clientId: input.clientId,
		domain,
		locale: input.locale,
		locations: input.locations,
		competitors,
		devices: input.devices,
		alertThreshold: input.alertThreshold,
		active: input.active
	};

	if (input.id) {
		const [existing] = await db
			.select({ id: table.rankProject.id })
			.from(table.rankProject)
			.where(and(eq(table.rankProject.id, input.id), eq(table.rankProject.tenantId, tenantId)))
			.limit(1);
		if (!existing) throw error(404, 'Proiect inexistent');
		await db.update(table.rankProject).set({ ...payload, updatedAt: now }).where(eq(table.rankProject.id, input.id));
		return { id: input.id };
	}
	const id = generateId();
	await db.insert(table.rankProject).values({ id, tenantId, ...payload, createdAt: now, updatedAt: now });
	return { id };
});

export const deleteRankProject = command(v.pipe(v.string(), v.minLength(1)), async (id) => {
	const { event, tenantId } = requireTenantEvent();
	await requireStaff(event);
	await db.delete(table.rankProject).where(and(eq(table.rankProject.id, id), eq(table.rankProject.tenantId, tenantId)));
	return { ok: true };
});

// ── Cuvinte cheie ──────────────────────────────────────────────────────
const addKeywordsSchema = v.object({
	projectId: v.pipe(v.string(), v.minLength(1)),
	keywords: v.pipe(v.array(v.string()), v.minLength(1)),
	tag: v.optional(v.nullable(v.string())),
	location: v.optional(v.string())
});

export const addRankKeywords = command(addKeywordsSchema, async (input) => {
	const { event, tenantId } = requireTenantEvent();
	await requireStaff(event);

	const [project] = await db
		.select({ id: table.rankProject.id })
		.from(table.rankProject)
		.where(and(eq(table.rankProject.id, input.projectId), eq(table.rankProject.tenantId, tenantId)))
		.limit(1);
	if (!project) throw error(404, 'Proiect inexistent');

	const location = input.location ?? '';
	// Dedup pe PROIECT, nu pe (proiect, locație): același cuvânt urmărit de două ori pentru
	// același site înseamnă două interogări Google pe zi și două rânduri identice în tabel.
	// Filtrul vechi era pe locație, așa că „angajare videochat" cu locația goală și același
	// cuvânt cu locația „România" intrau amândouă.
	const existing = await db
		.select({ keyword: table.rankKeyword.keyword })
		.from(table.rankKeyword)
		.where(eq(table.rankKeyword.projectId, input.projectId));
	const existingSet = new Set(existing.map((e) => normalizeKeyword(e.keyword)));
	const totalCount = existing.length;

	// Normalizăm și în interiorul listei primite: „Studio  Videochat" și „studio videochat"
	// sunt aceeași interogare pentru Google.
	const seen = new Set<string>();
	const clean: string[] = [];
	const duplicates: string[] = [];
	for (const raw of input.keywords) {
		const keyword = raw.trim().replace(/\s+/g, ' ');
		if (!keyword) continue;
		const key = normalizeKeyword(keyword);
		if (seen.has(key)) continue;
		seen.add(key);
		if (existingSet.has(key)) {
			duplicates.push(keyword);
			continue;
		}
		clean.push(keyword);
	}
	if (totalCount + clean.length > MAX_KEYWORDS) {
		throw error(400, `Limita de ${MAX_KEYWORDS} cuvinte cheie pe proiect ar fi depășită (ai ${totalCount}, adaugi ${clean.length}).`);
	}
	if (clean.length === 0) return { added: 0, duplicates };

	const now = new Date();
	await db.insert(table.rankKeyword).values(
		clean.map((keyword) => ({
			id: generateId(),
			projectId: input.projectId,
			keyword,
			tag: input.tag ?? null,
			location,
			active: true,
			createdAt: now,
			updatedAt: now
		}))
	);
	return { added: clean.length, duplicates };
});

export const deleteRankKeyword = command(v.pipe(v.string(), v.minLength(1)), async (keywordId) => {
	const { event, tenantId } = requireTenantEvent();
	await requireStaff(event);
	// verifică apartenența la tenant prin proiect
	const [row] = await db
		.select({ id: table.rankKeyword.id })
		.from(table.rankKeyword)
		.innerJoin(table.rankProject, eq(table.rankKeyword.projectId, table.rankProject.id))
		.where(and(eq(table.rankKeyword.id, keywordId), eq(table.rankProject.tenantId, tenantId)))
		.limit(1);
	if (!row) throw error(404, 'Cuvânt cheie inexistent');
	await db.delete(table.rankKeyword).where(eq(table.rankKeyword.id, keywordId));
	return { ok: true };
});

// ── Verifică acum ──────────────────────────────────────────────────────
/**
 * Bugetul de cuvinte verificate MANUAL pe oră, per proiect. Înlocuiește vechea regulă
 * „o rulare pe oră", care făcea imposibilă reverificarea unui singur cuvânt: costul real
 * față de Google e numărul de cuvinte, nu numărul de apăsări pe buton.
 */
const MANUAL_KEYWORDS_PER_HOUR = Number(env.RANK_MANUAL_KEYWORDS_PER_HOUR ?? 60) || 60;

const startCheckSchema = v.object({
	projectId: v.pipe(v.string(), v.minLength(1)),
	/** Lipsă sau gol = tot proiectul. */
	keywordIds: v.optional(v.array(v.pipe(v.string(), v.minLength(1))))
});

export const startRankCheck = command(startCheckSchema, async (input) => {
	const { event, tenantId, userId } = requireTenantEvent();
	await requireStaff(event);
	const { projectId } = input;

	const [project] = await db
		.select({ id: table.rankProject.id, devices: table.rankProject.devices })
		.from(table.rankProject)
		.where(and(eq(table.rankProject.id, projectId), eq(table.rankProject.tenantId, tenantId)))
		.limit(1);
	if (!project) throw error(404, 'Proiect inexistent');

	// Cuvintele cerute trebuie să fie chiar ale acestui proiect (scoping, nu doar filtrare).
	let keywordIds: string[] | undefined;
	if (input.keywordIds?.length) {
		const owned = await db
			.select({ id: table.rankKeyword.id })
			.from(table.rankKeyword)
			.where(
				and(
					eq(table.rankKeyword.projectId, projectId),
					eq(table.rankKeyword.active, true),
					inArray(table.rankKeyword.id, input.keywordIds)
				)
			);
		if (owned.length === 0) throw error(404, 'Cuvintele cheie nu aparțin acestui proiect.');
		keywordIds = owned.map((k) => k.id);
	}

	// deja o rulare activă?
	const raw = await getRedis().get(rankRunProgressKey(tenantId, projectId));
	if (raw) {
		try {
			if (!JSON.parse(raw).finishedAt) throw error(409, 'O verificare este deja în curs pentru acest proiect.');
		} catch (e) {
			if ((e as { status?: number })?.status === 409) throw e;
		}
	}

	// Buget orar în CUVINTE: o reverificare punctuală trece, o rulare completă repetată nu.
	const hourAgo = new Date(Date.now() - 3_600_000);
	const recent = await db
		.select({ checked: table.rankRun.keywordsChecked })
		.from(table.rankRun)
		.where(
			and(
				eq(table.rankRun.projectId, projectId),
				eq(table.rankRun.trigger, 'manual'),
				gte(table.rankRun.startedAt, hourAgo)
			)
		);
	const usedThisHour = recent.reduce((a, r) => a + (r.checked ?? 0), 0);
	const activeKeywords = keywordIds
		? keywordIds.length
		: (
				await db
					.select({ id: table.rankKeyword.id })
					.from(table.rankKeyword)
					.where(and(eq(table.rankKeyword.projectId, projectId), eq(table.rankKeyword.active, true)))
			).length;
	const devices = (project.devices as string[]).length || 1;
	const cost = activeKeywords * devices;
	if (usedThisHour + cost > MANUAL_KEYWORDS_PER_HOUR) {
		throw error(
			429,
			`Buget orar depășit: ${usedThisHour} din ${MANUAL_KEYWORDS_PER_HOUR} verificări manuale folosite în ultima oră, iar asta ar mai cere ${cost}. Încearcă mai târziu sau verifică mai puține cuvinte.`
		);
	}

	await getSchedulerQueue().add(
		'rank-project-check',
		{ type: 'rank_project_check', params: { tenantId, projectId, trigger: 'manual', triggeredBy: userId, keywordIds } },
		{ jobId: `rank-project-check-${projectId}-${Date.now()}`, attempts: 1, removeOnComplete: true, removeOnFail: true }
	);
	return { started: true, keywords: activeKeywords };
});

export const sendRankReportNow = command(async () => {
	const { event, tenantId } = requireTenantEvent();
	await requireStaff(event);
	const { buildRankReportData } = await import('$lib/server/rank-tracker/report');
	const { isoWeekKey } = await import('$lib/logic/rank-tracker');
	const weekKey = isoWeekKey(new Date());
	const data = await buildRankReportData(tenantId, weekKey);
	const [settings] = await db
		.select({ recipients: table.rankSettings.recipients })
		.from(table.rankSettings)
		.where(eq(table.rankSettings.tenantId, tenantId))
		.limit(1);
	const recipients = (settings?.recipients as string[]) ?? [];
	if (recipients.length === 0) return { sent: 0, note: 'fără destinatari' };
	const { sendRankReportEmail } = await import('$lib/server/email');
	for (const recipient of recipients) await sendRankReportEmail(tenantId, recipient, data);
	return { sent: recipients.length };
});

// ── Integrare SERP (DataForSEO) ────────────────────────────────────────
const serpSchema = v.object({
	login: v.pipe(v.string(), v.minLength(1)),
	password: v.pipe(v.string(), v.minLength(1))
});

export const saveSerpIntegration = command(serpSchema, async (input) => {
	const { event, tenantId } = requireTenantEvent();
	await requireStaff(event);
	const { encryptVerified } = await import('$lib/server/plugins/smartbill/crypto');
	const now = new Date();
	const [existing] = await db
		.select({ id: table.serpIntegration.id })
		.from(table.serpIntegration)
		.where(eq(table.serpIntegration.tenantId, tenantId))
		.limit(1);
	const values = {
		provider: 'dataforseo' as const,
		loginEncrypted: encryptVerified(tenantId, input.login),
		passwordEncrypted: encryptVerified(tenantId, input.password),
		isActive: true,
		lastError: null,
		updatedAt: now
	};
	if (existing) {
		await db.update(table.serpIntegration).set(values).where(eq(table.serpIntegration.id, existing.id));
	} else {
		await db.insert(table.serpIntegration).values({ id: generateId(), tenantId, ...values, createdAt: now });
	}
	// NU returnăm niciodată credențialele.
	return { ok: true };
});
