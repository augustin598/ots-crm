// Job zilnic: pentru fiecare tenant cu integrare GSC activă, trage performanța
// ultimelor `GSC_WINDOW_DAYS` zile pentru fiecare proiect care are proprietate
// configurată și scrie o linie per (cuvânt urmărit, dispozitiv, zi GSC).
// O proprietate care crapă (403, proprietate ștearsă) NU oprește restul cozii.
import { and, eq } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { logInfo, logError, serializeError } from '$lib/server/logger';
import { gscPullWindow, parseGscRows, type GscRow } from '$lib/logic/gsc';
import { normalizeKeyword } from '$lib/logic/rank-tracker';
import { querySearchAnalytics } from '$lib/server/gsc/client';

function generateId(): string {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

export interface GscDailyRow {
	keywordId: string;
	device: 'desktop' | 'mobile';
	gscDate: string;
	clicks: number;
	impressions: number;
	ctr: number;
	position: number;
}

export interface GscPullDeps {
	now?: () => Date;
	loadIntegrations?: () => Promise<{ tenantId: string }[]>;
	loadProjects?: (tenantId: string) => Promise<{ id: string; gscProperty: string | null }[]>;
	loadKeywords?: (projectId: string) => Promise<{ id: string; keyword: string }[]>;
	queryGsc?: (
		tenantId: string,
		property: string,
		window: { startDate: string; endDate: string }
	) => Promise<GscRow[]>;
	saveRows?: (rows: GscDailyRow[]) => Promise<void>;
	markSynced?: (tenantId: string, error: string | null) => Promise<void>;
}

export interface GscPullSummary {
	tenants: number;
	properties: number;
	rowsSaved: number;
	failed: number;
}

async function defaultLoadIntegrations() {
	return db
		.select({ tenantId: table.gscIntegration.tenantId })
		.from(table.gscIntegration)
		.where(eq(table.gscIntegration.isActive, true));
}

async function defaultLoadProjects(tenantId: string) {
	return db
		.select({ id: table.rankProject.id, gscProperty: table.rankProject.gscProperty })
		.from(table.rankProject)
		.where(and(eq(table.rankProject.tenantId, tenantId), eq(table.rankProject.active, true)));
}

async function defaultLoadKeywords(projectId: string) {
	return db
		.select({ id: table.rankKeyword.id, keyword: table.rankKeyword.keyword })
		.from(table.rankKeyword)
		.where(eq(table.rankKeyword.projectId, projectId));
}

/** Upsert pe (keyword, device, gscDate) — fereastra se retrage, deci rescriem. */
async function defaultSaveRows(rows: GscDailyRow[]) {
	const now = new Date();
	for (const row of rows) {
		await db
			.insert(table.rankGscDaily)
			.values({ id: generateId(), ...row, createdAt: now, updatedAt: now })
			.onConflictDoUpdate({
				target: [
					table.rankGscDaily.keywordId,
					table.rankGscDaily.device,
					table.rankGscDaily.gscDate
				],
				set: {
					clicks: row.clicks,
					impressions: row.impressions,
					ctr: row.ctr,
					position: row.position,
					updatedAt: now
				}
			});
	}
}

async function defaultMarkSynced(tenantId: string, error: string | null) {
	await db
		.update(table.gscIntegration)
		.set({ lastSyncAt: new Date(), lastError: error, updatedAt: new Date() })
		.where(eq(table.gscIntegration.tenantId, tenantId));
}

export async function processGscDailyPull(deps: GscPullDeps = {}): Promise<GscPullSummary> {
	const now = deps.now ?? (() => new Date());
	const loadIntegrations = deps.loadIntegrations ?? defaultLoadIntegrations;
	const loadProjects = deps.loadProjects ?? defaultLoadProjects;
	const loadKeywords = deps.loadKeywords ?? defaultLoadKeywords;
	const queryGsc = deps.queryGsc ?? querySearchAnalytics;
	const saveRows = deps.saveRows ?? defaultSaveRows;
	const markSynced = deps.markSynced ?? defaultMarkSynced;

	const window = gscPullWindow(now());
	const summary: GscPullSummary = { tenants: 0, properties: 0, rowsSaved: 0, failed: 0 };

	for (const { tenantId } of await loadIntegrations()) {
		summary.tenants++;
		let tenantError: string | null = null;

		for (const project of await loadProjects(tenantId)) {
			if (!project.gscProperty) continue; // proiect nelegat de GSC
			summary.properties++;
			try {
				const keywords = await loadKeywords(project.id);
				// potrivim pe forma canonică: GSC întoarce interogarea așa cum a scris-o userul
				const byKeyword = new Map(keywords.map((k) => [normalizeKeyword(k.keyword), k.id]));

				const rows: GscDailyRow[] = [];
				for (const rec of parseGscRows(await queryGsc(tenantId, project.gscProperty, window))) {
					const keywordId = byKeyword.get(rec.keyword);
					if (!keywordId) continue; // interogare pe care nu o urmărim (vezi Faza 2)
					rows.push({
						keywordId,
						device: rec.device,
						gscDate: rec.date,
						clicks: rec.clicks,
						impressions: rec.impressions,
						ctr: rec.ctr,
						position: rec.position
					});
				}
				if (rows.length) await saveRows(rows);
				summary.rowsSaved += rows.length;
			} catch (err) {
				summary.failed++;
				const { message } = serializeError(err);
				tenantError = message.slice(0, 500);
				logError('scheduler', `[gsc] ${project.gscProperty}: ${message}`, { tenantId });
			}
		}

		await markSynced(tenantId, tenantError);
	}

	logInfo(
		'scheduler',
		`[gsc] ${summary.tenants} tenanți, ${summary.properties} proprietăți, ${summary.rowsSaved} rânduri, ${summary.failed} eșecuri`
	);
	return summary;
}
