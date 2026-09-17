/**
 * Portalul clientului → „Credit de ore": sold + istoric, DOAR pentru clientul
 * autentificat (scoping pe `locals.client.id`, F8). Fără ajustări din portal.
 */
import { getRequestEvent, query } from '$app/server';
import { error } from '@sveltejs/kit';
import { getRequestAccessFlags } from '$lib/server/portal-access';
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
	// Layout-ul portalului gate-uiește doar navigarea; remote-ul se poate chema direct,
	// deci flag-ul per contact trebuie verificat și aici (ca la interviuri).
	const flags = await getRequestAccessFlags({
		tenantId: client.tenantId,
		clientId: client.id,
		userEmail: event.locals.user.email,
		isPrimary: event.locals.clientUser?.isPrimary ?? false
	});
	if (!flags.hourCredits) throw error(403, 'Nu ai acces la creditul de ore.');
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
		lowCreditThresholdMinutes: catalog.rules.lowCreditThresholdMinutes,
		stepMinutes: catalog.rules.stepMinutes,
		/** 0 = orele nu expiră (expirarea e pornită doar cu `creditExpiryDays > 0`). */
		expiryDays: catalog.rules.creditExpiryDays > 0 ? catalog.rules.creditExpiryDays : 0,
		/**
		 * Tariful conversiei apare DOAR clienților cu alimentare din facturi. Tarifele pe
		 * specializare nu ajung în portal.
		 */
		subscriptionRateEur: view.optedIn && reference ? reference.rateEur : null,
		// Fără numele userilor interni (spec §8): doar ce vede clientul. Nota unei
		// ajustări manuale sau a unei corecții e motivul intern al staff-ului — clientul
		// vede eticheta tipului.
		entries: view.entries.map((e) => {
			const internal = e.kind === 'manual' || e.kind === 'correction';
			return {
				id: e.id,
				deltaMinutes: e.deltaMinutes,
				kind: e.kind,
				note: internal ? null : e.note,
				realMinutes: internal ? null : e.realMinutes,
				createdAt: e.createdAt
			};
		})
	};
});
