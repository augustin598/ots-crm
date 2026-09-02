// Job lunar: reîmprospătează volumele de căutare pentru cuvintele cheie ale
// fiecărui tenant care are proiecte Rank Tracker active. Volumele vin din Google Ads.
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { rankProject } from '$lib/server/db/schema';
import { logInfo, serializeError, logError } from '$lib/server/logger';
import { refreshKeywordVolumes, type VolumeResult } from '$lib/server/rank-tracker/volume';

export interface RankVolumeDeps {
	loadTenants?: () => Promise<string[]>;
	refresh?: (tenantId: string) => Promise<VolumeResult>;
}

export interface RankVolumeResult {
	tenants: number;
	updated: number;
}

async function defaultLoadTenants(): Promise<string[]> {
	const rows = await db
		.selectDistinct({ tenantId: rankProject.tenantId })
		.from(rankProject)
		.where(eq(rankProject.active, true));
	return rows.map((r) => r.tenantId);
}

export async function processRankVolumeRefresh(deps: RankVolumeDeps = {}): Promise<RankVolumeResult> {
	const loadTenants = deps.loadTenants ?? defaultLoadTenants;
	const refresh = deps.refresh ?? refreshKeywordVolumes;

	const tenants = await loadTenants();
	let updated = 0;
	for (const tenantId of tenants) {
		try {
			const res = await refresh(tenantId);
			updated += res.updated;
		} catch (e) {
			logError('scheduler', `[rank] volume: tenant ${tenantId} eșuat: ${serializeError(e).message}`);
		}
	}

	if (updated > 0) logInfo('scheduler', `[rank] volume lunare: ${updated} cuvinte cheie pe ${tenants.length} tenanți`);
	return { tenants: tenants.length, updated };
}
