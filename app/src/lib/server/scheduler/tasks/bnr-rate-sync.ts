import { UnrecoverableError } from 'bullmq';
import { syncBnrRates } from '$lib/server/bnr/client';
import { logInfo, logError, logWarning, serializeError } from '$lib/server/logger';

/**
 * Errors that will never self-heal by retrying. Throw `UnrecoverableError` for
 * these so BullMQ gives up after attempt #1 instead of burning all 3 retries
 * (which produced the triple "certificate has expired" log spam).
 */
const NON_RETRYABLE_PATTERNS = [
	/certificate has expired/i,
	/unable to verify the first certificate/i,
	/self[- ]signed certificate/i,
	/CERT_HAS_EXPIRED/,
	/UNABLE_TO_VERIFY_LEAF_SIGNATURE/
];

function isNonRetryable(message: string): boolean {
	return NON_RETRYABLE_PATTERNS.some((r) => r.test(message));
}

/**
 * Scheduled task: sync BNR exchange rates daily.
 * Fetches XML from https://www.bnr.ro/nbrfxrates.xml and upserts into DB.
 */
export async function processBnrRateSync(): Promise<{
	success: boolean;
	synced: number;
	date: string;
}> {
	logInfo('scheduler', 'BNR rate sync starting', { metadata: { source: 'bnr.ro' } });

	try {
		const result = await syncBnrRates();
		logInfo('scheduler', `BNR rate sync completed: ${result.synced} rates for ${result.date}`, { metadata: { synced: result.synced, date: result.date } });
		return { success: true, ...result };
	} catch (error) {
		const { message, stack } = serializeError(error);

		if (isNonRetryable(message)) {
			// TLS/cert problems won't fix themselves in 1-4s; bail out cleanly
			// so tomorrow's cron gets a fresh shot instead of spamming logs 3x today.
			logWarning('scheduler', `BNR rate sync skipped (non-retryable): ${message}`, { stackTrace: stack });
			throw new UnrecoverableError(`BNR rate sync non-retryable: ${message}`);
		}

		logError('scheduler', `BNR rate sync failed: ${message}`, { stackTrace: stack });
		throw error;
	}
}
