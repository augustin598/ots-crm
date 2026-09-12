import { json, error } from '@sveltejs/kit';
import { sendHourCreditEmail } from '$lib/server/email';
import {
	buildHourCreditEmailBody,
	hourCreditEmailSubject
} from '$lib/server/hour-credit-email-body';
import type { HourCreditEvent } from '$lib/server/hour-credit-notifications';
import { sendText } from '$lib/server/whatsapp/session-manager';
import { getAppBaseUrl } from '$lib/server/app-url';
import { formatMinutes } from '$lib/logic/hourly-catalog';
import { serializeError } from '$lib/server/logger';
import type { RequestHandler } from './$types';

/**
 * Trimite pe adresa/numărul CERUT EXPLICIT cele trei notificări de credit de ore,
 * ca să le poți vedea fără să atingi un client real.
 *
 *   POST { toEmail?, toPhone?, kind?: 'credited'|'consumed'|'low'|'all', clientName? }
 *
 * - `toEmail` lipsă → adresa userului logat. NU acceptă adrese de clienți din CRM:
 *   destinatarul e cel din body, nimic nu se rezolvă din baza de date.
 * - `toPhone` (E.164, ex. 40757741036) trimite mesajul WhatsApp DIRECT persoanei.
 *   Dacă socketul nu e activ în acest proces (în dev, de obicei, e ținut de prod),
 *   întoarce eroarea ca text — NU deschide o sesiune nouă (ar rupe WhatsApp pe prod).
 *
 * Owner/admin. Nu scrie nimic în ledger și nu schimbă setările de notificare.
 */
function requireAdmin(event: Parameters<RequestHandler>[0]) {
	if (!event.locals.user || !event.locals.tenant) throw error(401, 'Unauthorized');
	const role = event.locals.tenantUser?.role;
	if (role !== 'owner' && role !== 'admin') {
		throw error(403, 'Forbidden: Admin access required');
	}
	return { tenantId: event.locals.tenant.id, tenantSlug: event.locals.tenant.slug };
}

const EVENTS: Record<'credited' | 'consumed' | 'low', { event: HourCreditEvent; balance: number }> =
	{
		credited: {
			event: { kind: 'credited', minutes: 1230, source: 'factura OTS 612 (TEST)' },
			balance: 1230
		},
		consumed: {
			event: {
				kind: 'consumed',
				taskId: 'debug',
				taskTitle: 'Landing page campanie toamnă (TEST)',
				realMinutes: 180,
				consumedMinutes: 213,
				overageRealMinutes: 45
			},
			balance: 1017
		},
		low: { event: { kind: 'low', balanceMinutes: 90, thresholdMinutes: 120 }, balance: 90 }
	};

function whatsappBody(clientName: string, ev: HourCreditEvent, balance: number, portalUrl: string) {
	const sold = `Sold: *${formatMinutes(balance)}*`;
	if (ev.kind === 'credited') {
		return `⏱️ *Credit de ore ${clientName}*\n+${formatMinutes(ev.minutes)} (${ev.source}).\n${sold}\n${portalUrl}`;
	}
	if (ev.kind === 'consumed') {
		const overage =
			ev.overageRealMinutes > 0
				? `\n⚠️ ${formatMinutes(ev.overageRealMinutes)} peste credit — se facturează separat.`
				: '';
		return `⏱️ *Task finalizat: ${ev.taskTitle}*\n${formatMinutes(ev.realMinutes)} lucrate, −${formatMinutes(ev.consumedMinutes)} din credit.${overage}\n${sold}\n${portalUrl}`;
	}
	return `⚠️ *Credit de ore scăzut — ${clientName}*\n${sold} (sub pragul de ${formatMinutes(ev.thresholdMinutes)}).\nPoți cumpăra ore: ${getAppBaseUrl()}/servicii`;
}

export const POST: RequestHandler = async (event) => {
	const { tenantId, tenantSlug } = requireAdmin(event);
	const body = (await event.request.json().catch(() => ({}))) as {
		toEmail?: string;
		toPhone?: string;
		kind?: string;
		clientName?: string;
	};

	const toEmail = (body.toEmail || event.locals.user!.email || '').trim();
	if (!toEmail) throw error(400, 'Lipsește adresa de email.');
	const clientName = body.clientName?.trim() || 'Client TEST';
	const kinds = (
		body.kind && body.kind !== 'all' ? [body.kind] : ['credited', 'consumed', 'low']
	) as Array<'credited' | 'consumed' | 'low'>;
	for (const k of kinds) {
		if (!EVENTS[k]) throw error(400, `kind necunoscut: ${k}`);
	}
	const portalUrl = `${getAppBaseUrl()}/client/${tenantSlug}/hour-credits`;

	const results: Array<Record<string, unknown>> = [];
	for (const kind of kinds) {
		const { event: ev, balance } = EVENTS[kind];
		const row: Record<string, unknown> = {
			kind,
			subject: hourCreditEmailSubject(clientName, ev),
			emailBodyChars: buildHourCreditEmailBody({
				clientName,
				event: ev,
				balanceMinutes: balance,
				portalUrl,
				servicesUrl: `${getAppBaseUrl()}/servicii`,
				themeColor: '#1877F2'
			}).length
		};
		try {
			await sendHourCreditEmail({
				tenantId,
				clientId: 'debug',
				clientEmail: toEmail,
				clientName,
				event: ev,
				balanceMinutes: balance,
				portalUrl
			});
			row.email = `trimis către ${toEmail}`;
		} catch (err) {
			row.email = `EȘUAT: ${serializeError(err).message}`;
		}
		if (body.toPhone) {
			const phone = body.toPhone.replace(/[^\d]/g, '');
			try {
				const wamId = await sendText(
					tenantId,
					phone,
					whatsappBody(clientName, ev, balance, portalUrl)
				);
				row.whatsapp = `trimis către ${phone} (${wamId})`;
			} catch (err) {
				row.whatsapp = `EȘUAT: ${serializeError(err).message}`;
			}
		}
		results.push(row);
	}

	return json({ ok: true, toEmail, toPhone: body.toPhone ?? null, results });
};
