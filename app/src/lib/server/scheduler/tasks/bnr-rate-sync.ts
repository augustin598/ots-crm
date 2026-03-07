import { syncBnrRates } from '$lib/server/bnr/client';
import { logInfo, logError, serializeError } from '$lib/server/logger';

/**
 * Scheduled task: sync BNR exchange rates daily.
 * Fetches XML from https://www.bnr.ro/nbrfxrates.xml and upserts into DB.
 */
export async function processBnrRateSync(): Promise<{
	success: boolean;
	synced: number;
	date: string;
}> {
	logInfo('scheduler', 'BNR rate sync starting');

	try {
		const result = await syncBnrRates();
		logInfo('scheduler', `BNR rate sync completed: ${result.synced} rates for ${result.date}`, { metadata: { synced: result.synced, date: result.date } });
		return { success: true, ...result };
	} catch (error) {
		const { message, stack } = serializeError(error);
		logError('scheduler', `BNR rate sync failed: ${message}`, { stackTrace: stack });
		throw error;
	}
}
