import { syncBnrRates } from '$lib/server/bnr/client';

/**
 * Scheduled task: sync BNR exchange rates daily.
 * Fetches XML from https://www.bnr.ro/nbrfxrates.xml and upserts into DB.
 */
export async function processBnrRateSync(): Promise<{
	success: boolean;
	synced: number;
	date: string;
}> {
	console.log('[BNR Sync] Starting BNR rate sync...');

	try {
		const result = await syncBnrRates();
		console.log(`[BNR Sync] Completed: ${result.synced} rates for ${result.date}`);
		return { success: true, ...result };
	} catch (error) {
		console.error('[BNR Sync] Failed:', error);
		throw error;
	}
}
