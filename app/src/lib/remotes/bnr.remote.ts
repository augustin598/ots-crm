import { query, command, getRequestEvent } from '$app/server';
import { error } from '@sveltejs/kit';
import * as v from 'valibot';
import {
	getLatestBnrRates,
	getLatestBnrRate,
	syncBnrRates,
	getLastFetchTime
} from '$lib/server/bnr/client';
import { logError, serializeError } from '$lib/server/logger';

/**
 * Get latest BNR rates from DB (for Settings page display).
 * Returns rates for all currencies from the most recent date.
 */
export const getBnrRates = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user) {
		throw error(401, 'Unauthorized');
	}

	return await getLatestBnrRates();
});

/**
 * Get BNR rate for a specific currency (for invoice auto-fill).
 */
export const getBnrRate = query(v.string(), async (currency) => {
	const event = getRequestEvent();
	if (!event?.locals.user) {
		throw error(401, 'Unauthorized');
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
		throw error(401, 'Unauthorized');
	}

	// Rate limit: max 1 request per 5 minutes
	const lastFetch = await getLastFetchTime();
	if (lastFetch) {
		const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
		if (lastFetch > fiveMinutesAgo) {
			throw error(
				429,
				'Cursul a fost actualizat recent. Încearcă din nou peste câteva minute.'
			);
		}
	}

	try {
		return await syncBnrRates();
	} catch (err) {
		const { message, stack } = serializeError(err);
		const code = (err as { code?: string } | null)?.code;
		await logError('bnr', `refreshBnrRates failed: ${message}`, {
			stackTrace: stack,
			tenantId: event.locals.tenant.id,
			userId: event.locals.user.id,
			action: 'bnr_refresh',
			metadata: { code }
		});

		if (code === 'CERT_HAS_EXPIRED' || /certificate has expired/i.test(message)) {
			throw error(
				503,
				'BNR are momentan certificat SSL invalid pe server. Încearcă din nou peste câteva ore.'
			);
		}
		throw error(503, 'Serviciul BNR este temporar indisponibil. Încearcă din nou mai târziu.');
	}
});
