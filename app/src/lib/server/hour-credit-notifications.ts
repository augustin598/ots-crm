/**
 * Notificările creditului de ore (spec §8): email către client + WhatsApp în
 * grupul task-ului/clientului. Toate pleacă DUPĂ commit-ul din ledger, best-effort,
 * și respectă bifele din Settings → Tarife orare → Reguli credit.
 *
 * „Credit scăzut" se trimite o singură dată la trecerea sub prag
 * (`client.low_credit_notified_at`) și se reînarmează când soldul urcă peste prag.
 */
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { logError, logWarning, serializeError } from '$lib/server/logger';
import { getHourlyCatalog } from '$lib/server/hourly-catalog';
import { formatMinutes } from '$lib/logic/hourly-catalog';
import { getAppBaseUrl } from '$lib/server/app-url';
import { enqueueGroupMessage } from '$lib/server/whatsapp/outbox';
import { sendHourCreditEmail } from '$lib/server/email';

export type HourCreditEvent =
	| { kind: 'credited'; minutes: number; source: string }
	| {
			kind: 'consumed';
			taskId: string;
			taskTitle: string;
			realMinutes: number;
			consumedMinutes: number;
			overageRealMinutes: number;
	  }
	| { kind: 'low'; balanceMinutes: number; thresholdMinutes: number };

async function loadClient(tenantId: string, clientId: string) {
	const [client] = await db
		.select({
			id: table.client.id,
			name: table.client.name,
			email: table.client.email,
			balance: table.client.hourCreditMinutes,
			lowCreditNotifiedAt: table.client.lowCreditNotifiedAt
		})
		.from(table.client)
		.where(and(eq(table.client.id, clientId), eq(table.client.tenantId, tenantId)))
		.limit(1);
	return client ?? null;
}

/** Grupul WhatsApp bifat al task-ului (dacă există), altfel grupul clientului. */
async function resolveGroupJid(
	tenantId: string,
	clientId: string,
	taskId?: string | null
): Promise<string | null> {
	if (taskId) {
		const [byTask] = await db
			.select({ groupJid: table.whatsappGroup.groupJid, watched: table.whatsappGroup.watched })
			.from(table.task)
			.innerJoin(table.whatsappGroup, eq(table.whatsappGroup.id, table.task.whatsappGroupId))
			.where(and(eq(table.task.id, taskId), eq(table.task.tenantId, tenantId)))
			.limit(1);
		if (byTask?.watched) return byTask.groupJid;
	}
	const [byClient] = await db
		.select({ groupJid: table.whatsappGroup.groupJid })
		.from(table.whatsappGroup)
		.where(
			and(
				eq(table.whatsappGroup.tenantId, tenantId),
				eq(table.whatsappGroup.clientId, clientId),
				eq(table.whatsappGroup.watched, true)
			)
		)
		.limit(1);
	return byClient?.groupJid ?? null;
}

function buildWhatsappBody(
	clientName: string,
	ev: HourCreditEvent,
	balanceMinutes: number,
	portalUrl: string
): string {
	const sold = `Sold: *${formatMinutes(balanceMinutes)}*`;
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

/**
 * Trimite notificările pentru un eveniment și verifică pragul „credit scăzut".
 * Nu aruncă niciodată — apelanții sunt tranzacții deja comise.
 */
export async function notifyHourCreditEvent(params: {
	tenantId: string;
	clientId: string;
	event: HourCreditEvent;
}): Promise<void> {
	const { tenantId, clientId } = params;
	try {
		const [client, catalog, tenant] = await Promise.all([
			loadClient(tenantId, clientId),
			getHourlyCatalog(tenantId),
			db
				.select({ slug: table.tenant.slug })
				.from(table.tenant)
				.where(eq(table.tenant.id, tenantId))
				.limit(1)
		]);
		if (!client) return;
		const rules = catalog.rules;
		// Poarta: fără nicio bifă activă nu pleacă NIMIC spre client și nu se
		// consumă starea alertei „credit scăzut" (ca la activare să notifice corect).
		if (!rules.notifyEmail && !rules.notifyWhatsapp) return;
		const portalUrl = `${getAppBaseUrl()}/client/${tenant[0]?.slug ?? tenantId}/hour-credits`;

		const events: HourCreditEvent[] = [params.event];

		// Pragul „credit scăzut": o singură dată la trecerea sub prag; reînarmare peste prag.
		const below = client.balance < rules.lowCreditThresholdMinutes;
		if (below && !client.lowCreditNotifiedAt) {
			events.push({
				kind: 'low',
				balanceMinutes: client.balance,
				thresholdMinutes: rules.lowCreditThresholdMinutes
			});
			await db
				.update(table.client)
				.set({ lowCreditNotifiedAt: new Date() })
				.where(eq(table.client.id, clientId));
		} else if (!below && client.lowCreditNotifiedAt) {
			await db
				.update(table.client)
				.set({ lowCreditNotifiedAt: null })
				.where(eq(table.client.id, clientId));
		}

		for (const ev of events) {
			if (rules.notifyEmail && client.email) {
				try {
					await sendHourCreditEmail({
						tenantId,
						clientId,
						clientEmail: client.email,
						clientName: client.name,
						event: ev,
						balanceMinutes: client.balance,
						portalUrl
					});
				} catch (err) {
					logError(
						'server',
						`hour-credits: email ${ev.kind} eșuat — ${serializeError(err).message}`,
						{
							tenantId,
							metadata: { clientId }
						}
					);
				}
			}
			if (rules.notifyWhatsapp) {
				try {
					const groupJid = await resolveGroupJid(
						tenantId,
						clientId,
						ev.kind === 'consumed' ? ev.taskId : null
					);
					if (groupJid) {
						await enqueueGroupMessage({
							tenantId,
							groupJid,
							kind: 'hour-credit',
							dedupeKey: ev.kind === 'low' ? `hour-credit:low:${clientId}` : null,
							taskId: ev.kind === 'consumed' ? ev.taskId : null,
							body: buildWhatsappBody(client.name, ev, client.balance, portalUrl)
						});
					}
				} catch (err) {
					logWarning(
						'server',
						`hour-credits: WhatsApp ${ev.kind} eșuat — ${serializeError(err).message}`,
						{
							tenantId,
							metadata: { clientId }
						}
					);
				}
			}
		}
	} catch (err) {
		logError('server', `hour-credits: notificare eșuată — ${serializeError(err).message}`, {
			tenantId,
			metadata: { clientId }
		});
	}
}
