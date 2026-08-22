/**
 * Sănătatea sesiunii WhatsApp între mai multe instanțe.
 *
 * Problema reală (21 aug 2026, 22:27): la un rollout pornesc două pod-uri,
 * ambele restaurează sesiunea, WhatsApp acceptă un singur dispozitiv, unul
 * primește „conflict 440" și cedează. Dacă Kubernetes oprește tocmai pod-ul
 * care a câștigat, nicio instanță nu mai are socket, iar `whatsapp_session`
 * rămâne pe `connected` — deci nimic nu semnalizează și WhatsApp tace.
 *
 * Separarea care rezolvă: `status` spune ce ne dorim (starea intenționată),
 * `last_heartbeat_at` spune dacă există cu adevărat un proces care ține
 * socketul. Instanța cu socketul bate din minut în minut; dacă bătaia se
 * învechește, altă instanță preia — dar numai una, fiindcă preluarea se
 * revendică printr-un UPDATE condiționat, nu prin „cine ajunge primul".
 */
import { and, eq, isNull, lt, or } from 'drizzle-orm';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { logError, logInfo } from '$lib/server/logger';

export const HEARTBEAT_INTERVAL_MS = 60_000;
/** Trei bătăi ratate: destul cât să nu confundăm o pauză de GC cu o cădere. */
export const HEARTBEAT_STALE_MS = 3 * HEARTBEAT_INTERVAL_MS;

/** Identifică instanța curentă în loguri; pe Kubernetes e numele pod-ului. */
export const INSTANCE_ID =
	process.env.HOSTNAME || process.env.POD_NAME || `local-${process.pid}`;

export async function writeHeartbeat(tenantId: string): Promise<void> {
	await db
		.update(table.whatsappSession)
		.set({ lastHeartbeatAt: new Date(), heartbeatOwner: INSTANCE_ID, updatedAt: new Date() })
		.where(eq(table.whatsappSession.tenantId, tenantId));
}

/**
 * Șterge bătaia la oprirea instanței, ca următorul gardian să preia imediat,
 * fără să aștepte expirarea. Statusul rămâne neatins: e starea dorită, nu cea
 * reală, iar `restoreAllSessions` se bazează pe el la pornire.
 */
export async function clearHeartbeat(tenantId: string): Promise<void> {
	await db
		.update(table.whatsappSession)
		.set({ lastHeartbeatAt: null, heartbeatOwner: null, updatedAt: new Date() })
		.where(
			and(
				eq(table.whatsappSession.tenantId, tenantId),
				eq(table.whatsappSession.heartbeatOwner, INSTANCE_ID)
			)
		);
}

export type GuardDecision =
	| { action: 'none'; reason: 'not-wanted' | 'fresh' }
	| { action: 'heartbeat'; reason: 'we-hold-it' }
	| { action: 'takeover'; reason: 'stale' };

/**
 * Ce trebuie făcut pentru o sesiune, din perspectiva instanței curente. Pur,
 * ca să se poată testa fără DB și fără socket.
 */
export function decideSessionAction(input: {
	status: string;
	lastHeartbeatAt: Date | null;
	activeInThisProcess: boolean;
	now: Date;
}): GuardDecision {
	// Doar sesiunile care ar trebui să fie conectate ne interesează: una
	// deconectată intenționat sau care așteaptă QR nu se repornește singură.
	if (input.status !== 'connected') return { action: 'none', reason: 'not-wanted' };
	if (input.activeInThisProcess) return { action: 'heartbeat', reason: 'we-hold-it' };

	const age = input.lastHeartbeatAt
		? input.now.getTime() - input.lastHeartbeatAt.getTime()
		: Infinity;
	if (age <= HEARTBEAT_STALE_MS) return { action: 'none', reason: 'fresh' };
	return { action: 'takeover', reason: 'stale' };
}

/**
 * Revendică dreptul de a prelua sesiunea. Întoarce true doar instanței care a
 * câștigat cursa: condiția din WHERE se evaluează la scriere, deci două pod-uri
 * care pornesc gardianul în aceeași secundă nu pot prelua amândouă și nu se mai
 * bat pe socket.
 */
export async function claimTakeover(tenantId: string, now: Date): Promise<boolean> {
	const staleBefore = new Date(now.getTime() - HEARTBEAT_STALE_MS);
	const res = await db
		.update(table.whatsappSession)
		.set({ lastHeartbeatAt: now, heartbeatOwner: INSTANCE_ID, updatedAt: now })
		.where(
			and(
				eq(table.whatsappSession.tenantId, tenantId),
				eq(table.whatsappSession.status, 'connected'),
				or(
					isNull(table.whatsappSession.lastHeartbeatAt),
					lt(table.whatsappSession.lastHeartbeatAt, staleBefore)
				)
			)
		);
	return (res.rowsAffected ?? 0) > 0;
}

/**
 * Gardianul, chemat periodic din scheduler pe fiecare instanță. Repornește
 * sesiunea acolo unde e nevoie și lasă urmă vizibilă în loguri când o face:
 * o tăcere de câteva minute pe WhatsApp trebuie să se vadă, nu să se ghicească.
 */
export async function runSessionGuard(): Promise<{ checked: number; takenOver: number }> {
	const { getActiveSession, startSession } = await import('./session-manager');
	const now = new Date();

	const rows = await db
		.select({
			tenantId: table.whatsappSession.tenantId,
			status: table.whatsappSession.status,
			lastHeartbeatAt: table.whatsappSession.lastHeartbeatAt,
			heartbeatOwner: table.whatsappSession.heartbeatOwner
		})
		.from(table.whatsappSession);

	let takenOver = 0;

	for (const row of rows) {
		const decision = decideSessionAction({
			status: row.status,
			lastHeartbeatAt: row.lastHeartbeatAt,
			activeInThisProcess: Boolean(getActiveSession(row.tenantId)),
			now
		});

		if (decision.action === 'none') continue;

		if (decision.action === 'heartbeat') {
			// Sesiunea e vie aici, dar bătaia s-a învechit (proces ocupat, ceas
			// sărit): o împrospătăm, ca alt pod să nu pornească o preluare inutilă.
			await writeHeartbeat(row.tenantId);
			continue;
		}

		if (!(await claimTakeover(row.tenantId, now))) continue;

		logError('whatsapp', 'Sesiune fără instanță activă; o preiau', {
			tenantId: row.tenantId,
			metadata: {
				instance: INSTANCE_ID,
				previousOwner: row.heartbeatOwner,
				lastHeartbeatAt: row.lastHeartbeatAt?.toISOString() ?? null
			}
		});

		try {
			await startSession(row.tenantId);
			takenOver++;
			logInfo('whatsapp', 'Sesiune preluată cu succes', {
				tenantId: row.tenantId,
				metadata: { instance: INSTANCE_ID }
			});
		} catch (err) {
			// Eliberăm revendicarea, ca următoarea rundă să mai poată încerca.
			await db
				.update(table.whatsappSession)
				.set({ lastHeartbeatAt: null, heartbeatOwner: null, updatedAt: new Date() })
				.where(
					and(
						eq(table.whatsappSession.tenantId, row.tenantId),
						eq(table.whatsappSession.heartbeatOwner, INSTANCE_ID)
					)
				);
			logError('whatsapp', 'Preluarea sesiunii a eșuat', {
				tenantId: row.tenantId,
				metadata: { err: err instanceof Error ? err.message : String(err) }
			});
		}
	}

	return { checked: rows.length, takenOver };
}

/** Pentru endpointul de diagnostic: cât de veche e bătaia, în secunde. */
export async function sessionHeartbeatAge(tenantId: string): Promise<number | null> {
	const [row] = await db
		.select({ lastHeartbeatAt: table.whatsappSession.lastHeartbeatAt })
		.from(table.whatsappSession)
		.where(eq(table.whatsappSession.tenantId, tenantId))
		.limit(1);
	if (!row?.lastHeartbeatAt) return null;
	return Math.round((Date.now() - row.lastHeartbeatAt.getTime()) / 1000);
}
