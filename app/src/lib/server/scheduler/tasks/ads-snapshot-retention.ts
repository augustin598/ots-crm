// Daily 90-day retention sweep for ad_metric_snapshot.
// Keeps DB size bounded; without this, Turso would balloon over time.

import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { lt } from 'drizzle-orm';
import { logInfo, logError, serializeError } from '$lib/server/logger';

const RETENTION_DAYS = 90;

function ymd(d: Date): string {
	const fmt = new Intl.DateTimeFormat('sv-SE', {
		timeZone: 'Europe/Bucharest',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	});
	return fmt.format(d);
}

export async function processAdsSnapshotRetention(): Promise<{ deletedRows: number }> {
	const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400_000);
	const cutoffDate = ymd(cutoff);

	logInfo('scheduler', `ads-snapshot-retention: deleting snapshots before ${cutoffDate}`);

	try {
		const result = await db
			.delete(table.adMetricSnapshot)
			.where(lt(table.adMetricSnapshot.date, cutoffDate));
		const deletedRows = (result as { rowsAffected?: number })?.rowsAffected ?? 0;
		logInfo('scheduler', `ads-snapshot-retention: deleted ${deletedRows} rows`);
		return { deletedRows };
	} catch (e) {
		logError(
			'scheduler',
			`ads-snapshot-retention: failed: ${serializeError(e).message}`
		);
		throw e;
	}
}
