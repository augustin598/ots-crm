/**
 * Portalul clientului → „Credit de ore": sold + istoric, DOAR pentru clientul
 * autentificat (scoping pe `locals.client.id`, F8). Fără ajustări din portal.
 */
import { getRequestEvent, query } from '$app/server';
import { error } from '@sveltejs/kit';
import { getClientHourCredit } from '$lib/server/hour-credits';
import { computeReservedMinutes } from '$lib/server/task-credit';
import { getHourlyCatalog } from '$lib/server/hourly-catalog';
import { resolveReferenceRate } from '$lib/logic/hourly-catalog';

export const getMyHourCredit = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event.locals.isClientUser || !event.locals.client) {
		throw error(401, 'Unauthorized');
	}
	const client = event.locals.client;
	const [view, catalog, reserved] = await Promise.all([
		getClientHourCredit(client.tenantId, client.id),
		getHourlyCatalog(client.tenantId),
		computeReservedMinutes(client.tenantId, [client.id])
	]);
	if (!view) throw error(404, 'Clientul nu există.');
	const reference = resolveReferenceRate(catalog.rates, catalog.rules);
	return {
		balanceMinutes: view.balanceMinutes,
		reservedMinutes: reserved.get(client.id) ?? 0,
		reference: reference ? { label: reference.label, rateEur: reference.rateEur } : null,
		lowCreditThresholdMinutes: catalog.rules.lowCreditThresholdMinutes,
		// Fără numele userilor interni (spec §8): doar ce vede clientul.
		entries: view.entries.map((e) => ({
			id: e.id,
			deltaMinutes: e.deltaMinutes,
			kind: e.kind,
			note: e.note,
			realMinutes: e.realMinutes,
			createdAt: e.createdAt
		}))
	};
});
