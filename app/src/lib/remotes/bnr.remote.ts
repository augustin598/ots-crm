import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import {
	getLatestBnrRates,
	getLatestBnrRate,
	syncBnrRates,
	getLastFetchTime
} from '$lib/server/bnr/client';

/**
 * Get latest BNR rates from DB (for Settings page display).
 * Returns rates for all currencies from the most recent date.
 */
export const getBnrRates = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user) {
		throw new Error('Unauthorized');
	}

	return await getLatestBnrRates();
});

/**
 * Get BNR rate for a specific currency (for invoice auto-fill).
 */
export const getBnrRate = query(v.string(), async (currency) => {
	const event = getRequestEvent();
	if (!event?.locals.user) {
		throw new Error('Unauthorized');
	}

	const rate = await getLatestBnrRate(currency);
	return rate;
});

/**
 * Manually refresh BNR rates (rate limited: max 1 request per 5 minutes).
 */
export const refreshBnrRates = command(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	// Rate limit: max 1 request per 5 minutes
	const lastFetch = await getLastFetchTime();
	if (lastFetch) {
		const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
		if (lastFetch > fiveMinutesAgo) {
			throw new Error(
				'Cursul a fost actualizat recent. Încearcă din nou peste câteva minute.'
			);
		}
	}

	const result = await syncBnrRates();
	return result;
});
