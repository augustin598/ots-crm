/**
 * Lease-ul pe socketul WhatsApp: cine îl ține și de cât timp n-a mai dat semn.
 *
 * Problema pe care o rezolvă: la un rollout pornesc două pod-uri deodată,
 * amândouă restaurează aceeași sesiune Baileys și se bat pe ea („Connection
 * closed (440): Stream Errored (conflict)"). Câștigă unul singur, iar dacă
 * Kubernetes îl oprește tocmai pe acela nu mai are nimeni socket, în timp ce
 * `whatsapp_session.status` rămâne `connected` și nu semnalizează nimic.
 *
 * Soluția: rândul de sesiune ține și un proprietar (`owner_instance_id`) cu o
 * urmă proaspătă (`heartbeat_at`). Socketul se deschide doar după un `UPDATE`
 * condiționat care reușește, adică doar pe instanța care a luat lease-ul.
 * SQLite serializează scrierile, deci două pod-uri nu pot reuși amândouă:
 * al doilea vede urma proaspătă a primului și pleacă acasă.
 *
 * Partea de politică (cât de veche e o urmă, cine poate prelua) stă sus, fără
 * DB, ca să se poată testa izolat.
 */
import { and, eq, inArray, isNotNull, isNull, lt, or } from 'drizzle-orm';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';

/** Cât de des scrie urma instanța care ține socketul. */
export const HEARTBEAT_INTERVAL_MS = 60_000;
/**
 * Peste atât fără urmă, lease-ul e considerat abandonat și îl poate lua altcineva.
 * Trei bătăi ratate: destul cât să nu fure nimeni socketul la o pauză de GC sau
 * la o clipire a bazei, destul de puțin cât preluarea după un pod ucis să se
 * întâmple în minute, nu în ore.
 */
export const LEASE_STALE_MS = 3 * HEARTBEAT_INTERVAL_MS;
/** Cât de des încearcă fiecare instanță să preia o sesiune rămasă fără stăpân. */
export const ENSURE_INTERVAL_MS = 60_000;
/** Peste atât fără socket nicăieri, santinela zbiară. */
export const ALERT_AFTER_MS = 5 * 60_000;
/** Sub atât, nu repetăm alarma pentru aceeași sesiune. */
export const ALERT_REPEAT_MS = 30 * 60_000;

/**
 * Stările din care o sesiune merită preluată. `qr_pending` și `needs_reauth`
 * cer un om cu telefonul în mână, nu un pod care se oferă voluntar.
 */
export const TAKEOVER_STATUSES = ['connected', 'connecting', 'disconnected'] as const;

export type LeaseRow = {
	ownerInstanceId: string | null;
	heartbeatAt: Date | null;
};

/** Lease ținut de cineva viu (oricine, inclusiv noi). */
export function isLeaseFresh(row: LeaseRow, now: Date, staleMs = LEASE_STALE_MS): boolean {
	if (!row.ownerInstanceId) return false;
	if (!row.heartbeatAt) return false;
	return now.getTime() - row.heartbeatAt.getTime() < staleMs;
}

/**
 * Poate instanța `me` să ia socketul acum?
 *
 * Da dacă nu-l ține nimeni, dacă urma e veche, sau dacă îl ținem deja noi
 * (reintrarea trebuie să fie inofensivă: `startSession` se apelează și din
 * reconectarea automată).
 */
export function canClaim(row: LeaseRow, me: string, now: Date, staleMs = LEASE_STALE_MS): boolean {
	if (row.ownerInstanceId === me) return true;
	return !isLeaseFresh(row, now, staleMs);
}

/** De câte milisecunde n-a mai dat semn nimeni. `null` dacă n-a existat urmă. */
export function staleForMs(row: LeaseRow, now: Date): number | null {
	if (!row.heartbeatAt) return null;
	return now.getTime() - row.heartbeatAt.getTime();
}

/** Merită să dăm alarma acum pentru sesiunea asta? */
export function shouldAlert(
	row: { heartbeatAt: Date | null; staleAlertAt: Date | null },
	now: Date,
	alertAfterMs = ALERT_AFTER_MS,
	repeatMs = ALERT_REPEAT_MS
): boolean {
	const silentMs = row.heartbeatAt ? now.getTime() - row.heartbeatAt.getTime() : Infinity;
	if (silentMs < alertAfterMs) return false;
	if (!row.staleAlertAt) return true;
	return now.getTime() - row.staleAlertAt.getTime() >= repeatMs;
}

// ─── identitatea instanței ────────────────────────────────────────────────────

const INSTANCE_SYMBOL = Symbol.for('ots_crm_instance_id');
const GT = globalThis as unknown as Record<symbol, unknown>;

/**
 * Un nume stabil pe viața procesului. Numele pod-ului singur n-ar fi de ajuns:
 * la un restart rapid, noul proces ar moșteni lease-ul celui vechi și ar crede
 * că socketul e al lui, deși nu are niciunul. Sufixul aleator rupe legătura.
 */
export function instanceId(): string {
	const existing = GT[INSTANCE_SYMBOL] as string | undefined;
	if (existing) return existing;
	const host = process.env.HOSTNAME || process.env.POD_NAME || 'local';
	const suffix = crypto.randomUUID().slice(0, 8);
	const id = `${host}-${suffix}`;
	GT[INSTANCE_SYMBOL] = id;
	return id;
}

// ─── operațiile pe bază ───────────────────────────────────────────────────────

/**
 * Ia lease-ul, dacă se poate. Întoarce `false` când altcineva îl ține proaspăt,
 * iar atunci apelantul NU trebuie să deschidă socketul.
 *
 * `force` e pentru acțiunile explicite ale unui om (butonul de conectare,
 * `_debug-whatsapp-reload`): acolo furtul e intenția, nu accidentul. Instanța
 * care pierde lease-ul își închide singură socketul la următoarea reînnoire.
 */
export async function claimLease(
	tenantId: string,
	options: { force?: boolean } = {}
): Promise<boolean> {
	const me = instanceId();
	const now = new Date();
	const staleBefore = new Date(now.getTime() - LEASE_STALE_MS);

	const takeable = or(
		isNull(table.whatsappSession.ownerInstanceId),
		eq(table.whatsappSession.ownerInstanceId, me),
		isNull(table.whatsappSession.heartbeatAt),
		lt(table.whatsappSession.heartbeatAt, staleBefore)
	);

	const res = await db
		.update(table.whatsappSession)
		.set({ ownerInstanceId: me, heartbeatAt: now, staleAlertAt: null, updatedAt: now })
		.where(
			options.force
				? eq(table.whatsappSession.tenantId, tenantId)
				: and(eq(table.whatsappSession.tenantId, tenantId), takeable)
		);

	return (res.rowsAffected ?? 0) > 0;
}

/**
 * Scrie urma. Întoarce `false` dacă între timp lease-ul a ajuns la altcineva,
 * caz în care apelantul își închide socketul: două socket-uri pe aceeași
 * sesiune înseamnă conflict 440 la nesfârșit.
 */
export async function renewLease(tenantId: string): Promise<boolean> {
	const me = instanceId();
	const now = new Date();
	const res = await db
		.update(table.whatsappSession)
		.set({ heartbeatAt: now, staleAlertAt: null, updatedAt: now })
		.where(
			and(
				eq(table.whatsappSession.tenantId, tenantId),
				eq(table.whatsappSession.ownerInstanceId, me)
			)
		);
	return (res.rowsAffected ?? 0) > 0;
}

/**
 * Dă drumul lease-ului, doar dacă e al nostru. Condiția pe proprietar contează:
 * un pod care se oprește după ce i s-a luat socketul n-are voie să șteargă
 * urma proaspătă a celui care îl ține acum.
 */
export async function releaseLease(
	tenantId: string,
	patch: Partial<typeof table.whatsappSession.$inferInsert> = {}
): Promise<boolean> {
	const me = instanceId();
	const res = await db
		.update(table.whatsappSession)
		.set({ ownerInstanceId: null, heartbeatAt: null, updatedAt: new Date(), ...patch })
		.where(
			and(
				eq(table.whatsappSession.tenantId, tenantId),
				eq(table.whatsappSession.ownerInstanceId, me)
			)
		);
	return (res.rowsAffected ?? 0) > 0;
}

/**
 * Sesiunile care ar trebui să aibă socket și n-au niciunul viu.
 *
 * `phoneE164 IS NOT NULL` e filtrul care ține sesiunile scoase din priză
 * intenționat în priză scoasă: „Deconectează" face logout și golește telefonul,
 * deci un rând fără telefon n-a fost niciodată împerecheat sau a fost scos
 * dinadins. Fără filtrul ăsta, bucla de preluare ar învia la nesfârșit o
 * sesiune deconectată de un om și ar cere QR din senin.
 */
export async function listOrphanSessions(now = new Date()): Promise<
	Array<{ tenantId: string; status: string; heartbeatAt: Date | null; ownerInstanceId: string | null }>
> {
	const staleBefore = new Date(now.getTime() - LEASE_STALE_MS);
	return db
		.select({
			tenantId: table.whatsappSession.tenantId,
			status: table.whatsappSession.status,
			heartbeatAt: table.whatsappSession.heartbeatAt,
			ownerInstanceId: table.whatsappSession.ownerInstanceId
		})
		.from(table.whatsappSession)
		.where(
			and(
				inArray(table.whatsappSession.status, [...TAKEOVER_STATUSES]),
				isNotNull(table.whatsappSession.phoneE164),
				or(
					isNull(table.whatsappSession.ownerInstanceId),
					isNull(table.whatsappSession.heartbeatAt),
					lt(table.whatsappSession.heartbeatAt, staleBefore)
				)
			)
		);
}

/** Pentru diagnostic și pentru santinelă. */
export async function readLease(tenantId: string): Promise<
	| {
			status: string;
			ownerInstanceId: string | null;
			heartbeatAt: Date | null;
			staleAlertAt: Date | null;
	  }
	| null
> {
	const [row] = await db
		.select({
			status: table.whatsappSession.status,
			ownerInstanceId: table.whatsappSession.ownerInstanceId,
			heartbeatAt: table.whatsappSession.heartbeatAt,
			staleAlertAt: table.whatsappSession.staleAlertAt
		})
		.from(table.whatsappSession)
		.where(eq(table.whatsappSession.tenantId, tenantId))
		.limit(1);
	return row ?? null;
}

/** Marchează momentul alarmei, ca să n-o repetăm la fiecare rulare. */
export async function markAlerted(tenantId: string, at = new Date()): Promise<void> {
	await db
		.update(table.whatsappSession)
		.set({ staleAlertAt: at })
		.where(eq(table.whatsappSession.tenantId, tenantId));
}
