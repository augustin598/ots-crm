/**
 * Santinela socketului WhatsApp.
 *
 * Fără ea, o sesiune fără stăpân e o tăcere perfectă: `whatsapp_session.status`
 * rămâne pe `connected` de la pod-ul mort, interfața arată verde, mesajele
 * intrate nu ajung nicăieri, iar comanda `/task` scrisă în grup se pierde fără
 * urmă. Exact ce s-a întâmplat pe 21 august la 22:27.
 *
 * Ce face, la fiecare rulare:
 *  1. compară urma (`heartbeat_at`) cu ceasul; peste cinci minute de tăcere,
 *     socketul nu mai e la nimeni;
 *  2. scoate minciuna din baza de date: `connected` devine `disconnected`, deci
 *     și pagina, și `loadSessionIdForTenant` spun adevărul;
 *  3. dă alarma acolo unde se vede: eroare în Admin → Logs, notificare în
 *     aplicație pentru administratori și, dacă au bot legat, pe Telegram.
 *
 * Preluarea propriu-zisă nu se face aici, ci în bucla din `session-manager`
 * (`ensureSessionsClaimed`), care rulează pe fiecare instanță, nu doar pe cea
 * care a prins jobul de scheduler.
 */
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { logError, logInfo, logWarning, serializeError } from '$lib/server/logger';
import { createNotification } from '$lib/server/notifications';
import { sendTelegramMessage } from '$lib/server/telegram/sender';
import {
	ALERT_AFTER_MS,
	TAKEOVER_STATUSES,
	markAlerted,
	shouldAlert
} from '$lib/server/whatsapp/session-lease';

/** Minutele de tăcere, rotunjite, pentru textul alarmei. */
function silentMinutes(heartbeatAt: Date | null, now: Date): number | null {
	if (!heartbeatAt) return null;
	return Math.max(0, Math.round((now.getTime() - heartbeatAt.getTime()) / 60_000));
}

export function buildAlertText(tenantSlug: string, minutes: number | null): string {
	const cat = minutes === null ? 'de la ultima repornire' : `de ${minutes} minute`;
	return (
		`🔴 WhatsApp fără socket ${cat} pe „${tenantSlug}". ` +
		'Nicio instanță nu ține conexiunea, deci mesajele primite și comenzile /task se pierd. ' +
		'Deschide pagina WhatsApp și apasă „Conectează" dacă nu revine singur în câteva minute.'
	);
}

async function alertAdmins(tenantId: string, tenantSlug: string, text: string): Promise<void> {
	const admins = await db
		.select({ userId: table.tenantUser.userId, role: table.tenantUser.role })
		.from(table.tenantUser)
		.where(eq(table.tenantUser.tenantId, tenantId));

	for (const admin of admins) {
		if (admin.role !== 'owner' && admin.role !== 'admin') continue;
		try {
			await createNotification({
				tenantId,
				userId: admin.userId,
				type: 'whatsapp.session_down',
				title: 'WhatsApp deconectat',
				message: text,
				link: `/${tenantSlug}/whatsapp`,
				priority: 'high'
			});
		} catch (e) {
			logWarning('scheduler', `[whatsapp-watchdog] notificarea în aplicație a picat: ${serializeError(e).message}`, {
				tenantId
			});
		}
		try {
			await sendTelegramMessage({ tenantId, userId: admin.userId, text });
		} catch (e) {
			logWarning('scheduler', `[whatsapp-watchdog] alerta pe Telegram a picat: ${serializeError(e).message}`, {
				tenantId
			});
		}
	}
}

export async function processWhatsappSessionWatchdog(): Promise<{
	checked: number;
	silent: number;
	alerted: number;
}> {
	const now = new Date();

	const rows = await db
		.select({
			tenantId: table.whatsappSession.tenantId,
			tenantSlug: table.tenant.slug,
			status: table.whatsappSession.status,
			heartbeatAt: table.whatsappSession.heartbeatAt,
			staleAlertAt: table.whatsappSession.staleAlertAt,
			ownerInstanceId: table.whatsappSession.ownerInstanceId
		})
		.from(table.whatsappSession)
		.innerJoin(table.tenant, eq(table.tenant.id, table.whatsappSession.tenantId))
		.where(
			and(
				inArray(table.whatsappSession.status, [...TAKEOVER_STATUSES]),
				// Fără telefon, sesiunea n-a fost niciodată împerecheată sau a fost
				// scoasă din priză de un om. Nu e o avarie, deci nu e alarmă.
				isNotNull(table.whatsappSession.phoneE164)
			)
		);

	let silent = 0;
	let alerted = 0;

	for (const row of rows) {
		const silentMs = row.heartbeatAt ? now.getTime() - row.heartbeatAt.getTime() : Infinity;
		if (silentMs < ALERT_AFTER_MS) continue;
		silent++;

		// Baza nu mai are voie să spună „conectat" când nu ține nimeni socketul.
		if (row.status === 'connected' || row.status === 'connecting') {
			await db
				.update(table.whatsappSession)
				.set({
					status: 'disconnected',
					lastDisconnectedAt: now,
					lastError: 'nicio instanță nu ține socketul (urmă expirată)',
					updatedAt: now
				})
				.where(eq(table.whatsappSession.tenantId, row.tenantId));
		}

		if (!shouldAlert(row, now)) continue;

		const minutes = silentMinutes(row.heartbeatAt, now);
		const text = buildAlertText(row.tenantSlug, minutes);
		logError('whatsapp', text, {
			tenantId: row.tenantId,
			metadata: {
				minute: minutes,
				ultimulProprietar: row.ownerInstanceId,
				statusInainte: row.status
			}
		});
		await alertAdmins(row.tenantId, row.tenantSlug, text);
		await markAlerted(row.tenantId, now);
		alerted++;
	}

	if (silent === 0) {
		logInfo('scheduler', `whatsapp-session-watchdog: ${rows.length} sesiuni, toate cu socket viu`);
	}

	return { checked: rows.length, silent, alerted };
}
