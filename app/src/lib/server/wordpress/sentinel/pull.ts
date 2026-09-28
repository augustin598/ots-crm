/**
 * Citește jurnalul Sentinel al unui site prin conector, îl clasifică și îl
 * salvează. Folosit de jobul zilnic (`trigger: 'daily'`) și de butonul
 * „Citește acum” (`'manual'`). Nu trimite nimic pe Telegram: findings-urile se
 * adaugă la `pendingFindings`, iar jobul zilnic le trimite pe toate.
 */
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { getRedis } from '$lib/server/redis';
import { loadSiteAndClient } from '../sync';
import { compareConnectorVersions } from '../connector-release';
import { logInfo, logWarning, serializeError } from '$lib/server/logger';
import { detectFindings } from './rules';
import { parseState, type Finding, type SentinelEvent, type SentinelScan, type WpSentinelResponse } from './types';

export const SENTINEL_MIN_CONNECTOR = '0.9.0';
/** Suprapunere cu citirea anterioară (ceasuri decalate, rotiri); evenimentele deja salvate se filtrează. */
const OVERLAP_MS = 60 * 60 * 1000;
const MAX_PAGES = 20;
const INSERT_CHUNK = 100;
const LOOKUP_CHUNK = 500; // limita de parametri SQLite
const MAX_PENDING = 200;
/** Evenimentele mai vechi decât atât nu se mai inserează (ar fi oricum purjate la jobul zilnic); tot intră în reguli pentru baseline. */
export const SENTINEL_RETENTION_DAYS = 7;
const RETENTION_MS = SENTINEL_RETENTION_DAYS * 24 * 60 * 60 * 1000;

/** Lock per site (Redis `SET NX EX`) — evită o citire manuală și jobul zilnic suprapunându-se pe același site. */
const SITE_LOCK_TTL_SEC = 960; // 16 min — generos față de bugetul de 45 s × 20 pagini
const SITE_LOCK_POLL_MS = 1000;
const DAILY_LOCK_WAIT_MS = 60_000;

export type PullStatus = 'ok' | 'legacy' | 'unsupported' | 'error';
export type PullTrigger = 'daily' | 'manual';

export interface PullResult {
	siteId: string;
	siteName: string;
	status: PullStatus;
	inserted: number;
	/** findings-urile acestei citiri */
	findings: Finding[];
	/** toate findings-urile încă netrimise pe Telegram (după această citire) */
	pending: Finding[];
	/** zile consecutive fără răspuns (contorul jobului zilnic) */
	failures: number;
	error?: string;
	scan?: { files: number; scannedFiles: number; truncated: boolean };
}

function newId() {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

export function supportsSentinel(connectorVersion: string | null | undefined): boolean {
	return !!connectorVersion && compareConnectorVersions(connectorVersion, SENTINEL_MIN_CONNECTOR) >= 0;
}

function safeDate(t: string | undefined): Date | null {
	if (!t) return null;
	const d = new Date(t);
	return Number.isNaN(d.getTime()) ? null : d;
}

const bucharestDateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bucharest' });
/** Ziua calendaristică a României pentru `now`, format `YYYY-MM-DD`. */
function bucharestDate(now: Date): string {
	return bucharestDateFmt.format(now);
}

/**
 * `lastFailureDay` nu face parte din `SentinelState` (types.ts nu e al meu) —
 * e o proprietate în plus în JSON-ul din `sentinel_state`, ignorată de
 * `parseState`. O citim direct din raw și o re-atașăm la fiecare scriere.
 */
function readLastFailureDay(raw: string | null | undefined): string | undefined {
	if (!raw) return undefined;
	try {
		const p = JSON.parse(raw) as { lastFailureDay?: string };
		return typeof p.lastFailureDay === 'string' ? p.lastFailureDay : undefined;
	} catch {
		return undefined;
	}
}

/** Incrementează `sentinelFailures` cel mult o dată pe zi calendaristică (ora României), doar pentru `trigger: 'daily'`. */
function nextDailyFailure(
	trigger: PullTrigger,
	priorFailures: number,
	lastFailureDay: string | undefined,
	now: Date
): { failures: number; lastFailureDay: string | undefined } {
	if (trigger !== 'daily') return { failures: priorFailures, lastFailureDay };
	const today = bucharestDate(now);
	if (lastFailureDay === today) return { failures: priorFailures, lastFailureDay };
	return { failures: priorFailures + 1, lastFailureDay: today };
}

async function storedUids(siteId: string, uids: string[]): Promise<Set<string>> {
	const found = new Set<string>();
	for (let i = 0; i < uids.length; i += LOOKUP_CHUNK) {
		const rows = await db
			.select({ eventUid: table.wordpressSecurityEvent.eventUid })
			.from(table.wordpressSecurityEvent)
			.where(
				and(
					eq(table.wordpressSecurityEvent.siteId, siteId),
					inArray(table.wordpressSecurityEvent.eventUid, uids.slice(i, i + LOOKUP_CHUNK))
				)
			);
		for (const r of rows) found.add(r.eventUid);
	}
	return found;
}

interface MinimalSiteRow {
	id: string;
	tenantId: string;
	name: string;
	sentinelFailures: number;
	sentinelState: string | null;
}

/** Citire directă, minimă — folosită doar când `loadSiteAndClient` nu e disponibil (a aruncat, sau lock ocupat). */
async function selectSiteRow(siteId: string): Promise<MinimalSiteRow | undefined> {
	const [row] = await db
		.select({
			id: table.wordpressSite.id,
			tenantId: table.wordpressSite.tenantId,
			name: table.wordpressSite.name,
			sentinelFailures: table.wordpressSite.sentinelFailures,
			sentinelState: table.wordpressSite.sentinelState
		})
		.from(table.wordpressSite)
		.where(eq(table.wordpressSite.id, siteId));
	return row as MinimalSiteRow | undefined;
}

// --- Lock per site ---------------------------------------------------------

export class SiteBusyError extends Error {
	constructor(message = 'Citire în curs pentru acest site') {
		super(message);
		this.name = 'SiteBusyError';
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Rulează `fn` sub un lock Redis per site (`sentinel:pull:<siteId>`), ca o
 * citire manuală și jobul zilnic să nu se suprapună pe același site (citire
 * paginată + scriere de stare — o suprapunere ar putea pierde findings sau
 * scrie o stare stale). `waitMs: 0` (citire manuală) aruncă imediat dacă altă
 * citire e în curs; `waitMs` mai mare (jobul zilnic) așteaptă, verificând la
 * fiecare ~1 s. Dacă Redis însuși nu răspunde, rulează fără lock —
 * disponibilitatea contează mai mult decât excluderea mutuală strictă aici.
 */
export async function withSiteLock<T>(siteId: string, fn: () => Promise<T>, opts: { waitMs: number }): Promise<T> {
	const key = `sentinel:pull:${siteId}`;
	const token = crypto.randomUUID();
	let acquired = false;
	try {
		const redis = getRedis();
		const deadline = Date.now() + opts.waitMs;
		while (true) {
			const res = await redis.set(key, token, 'EX', SITE_LOCK_TTL_SEC, 'NX');
			if (res === 'OK') {
				acquired = true;
				break;
			}
			const remaining = deadline - Date.now();
			if (remaining <= 0) break;
			await sleep(Math.min(SITE_LOCK_POLL_MS, remaining));
		}
	} catch (err) {
		logWarning('wordpress', `Sentinel lock indisponibil pentru ${siteId}: ${serializeError(err).message} — rulez fără lock`, {
			metadata: { siteId }
		});
		return fn();
	}
	if (!acquired) {
		throw new SiteBusyError();
	}
	try {
		return await fn();
	} finally {
		try {
			const redis = getRedis();
			const current = await redis.get(key);
			if (current === token) await redis.del(key);
		} catch {
			// Redis a aruncat la eliberare — lock-ul expiră oricum prin TTL.
		}
	}
}

// --- Citire eșuată înainte de a avea `site` (loadSiteAndClient / lock ocupat) ---

async function loadFailureResult(siteId: string, trigger: PullTrigger, now: Date, err: unknown): Promise<PullResult> {
	const { message } = serializeError(err);
	const row = await selectSiteRow(siteId);
	const priorState = parseState(row?.sentinelState);
	const lastFailureDay = readLastFailureDay(row?.sentinelState);
	const { failures, lastFailureDay: newDay } = nextDailyFailure(trigger, row?.sentinelFailures ?? 0, lastFailureDay, now);
	await db
		.update(table.wordpressSite)
		.set({
			sentinelLastPullStatus: 'error',
			...(trigger === 'daily' ? { sentinelFailures: failures } : {}),
			sentinelState: JSON.stringify({ ...priorState, lastError: message, lastFailureDay: newDay }),
			updatedAt: now
		})
		.where(eq(table.wordpressSite.id, siteId));
	logWarning('wordpress', `Sentinel FAILED (load) ${siteId} (${trigger}): ${message}`, {
		tenantId: row?.tenantId ?? '',
		metadata: { siteId, failures }
	});
	return {
		siteId,
		siteName: row?.name ?? siteId,
		status: 'error',
		inserted: 0,
		findings: [],
		pending: priorState.pendingFindings,
		failures,
		error: message
	};
}

/** Rezultat sintetic când lock-ul rămâne ocupat până la capătul așteptării — nimic scris în DB. */
async function busyResult(siteId: string): Promise<PullResult> {
	const row = await selectSiteRow(siteId);
	const state = parseState(row?.sentinelState);
	return {
		siteId,
		siteName: row?.name ?? siteId,
		status: 'error',
		inserted: 0,
		findings: [],
		pending: state.pendingFindings,
		failures: row?.sentinelFailures ?? 0,
		error: 'citire în curs'
	};
}

export async function pullSite(siteId: string, opts: { now?: Date; trigger: PullTrigger }): Promise<PullResult> {
	const now = opts.now ?? new Date();
	const waitMs = opts.trigger === 'daily' ? DAILY_LOCK_WAIT_MS : 0;
	try {
		return await withSiteLock(siteId, () => pullSiteLocked(siteId, opts.trigger, now), { waitMs });
	} catch (err) {
		if (err instanceof SiteBusyError && opts.trigger === 'daily') {
			// Citirea manuală lasă SiteBusyError să se propage (comanda remote îl arată ca eroare); jobul zilnic nu are cui să-i arate un toast.
			return busyResult(siteId);
		}
		throw err;
	}
}

async function pullSiteLocked(siteId: string, trigger: PullTrigger, now: Date): Promise<PullResult> {
	let site: Awaited<ReturnType<typeof loadSiteAndClient>>['site'];
	let client: Awaited<ReturnType<typeof loadSiteAndClient>>['client'];
	try {
		({ site, client } = await loadSiteAndClient(siteId));
	} catch (err) {
		return loadFailureResult(siteId, trigger, now, err);
	}

	const state = parseState(site.sentinelState);
	const lastFailureDay = readLastFailureDay(site.sentinelState);
	const base = {
		siteId: site.id,
		siteName: site.name,
		inserted: 0,
		findings: [] as Finding[],
		pending: state.pendingFindings
	};

	if (!supportsSentinel(site.connectorVersion)) {
		await db
			.update(table.wordpressSite)
			.set({ sentinelLastPullStatus: 'unsupported', updatedAt: now })
			.where(eq(table.wordpressSite.id, site.id));
		return { ...base, status: 'unsupported', failures: site.sentinelFailures };
	}

	const since = site.sentinelLastPullAt
		? new Date(site.sentinelLastPullAt.getTime() - OVERLAP_MS).toISOString()
		: null;

	try {
		const events: SentinelEvent[] = [];
		let scan: SentinelScan | null = null;
		let legacy = false;
		const errors: string[] = [];
		let lastResp: WpSentinelResponse | null = null;
		for (let pageNo = 0; pageNo < MAX_PAGES; pageNo++) {
			const resp = await client.sentinel({ since, skip: events.length }, { siteId: site.id });
			if (!resp || !Array.isArray(resp.events)) throw new Error('Răspuns Sentinel invalid');
			events.push(...resp.events);
			if (pageNo === 0) {
				scan = resp.scan ?? null;
				legacy = resp.sentinel?.legacyMuPlugin === true;
			}
			errors.push(...(resp.errors ?? []));
			lastResp = resp;
			if (!resp.hasMore || resp.events.length === 0) break;
		}

		// S-a atins plafonul de pagini cu încă evenimente de citit: continuăm de unde am rămas
		// data viitoare (suprapunerea de 1 h deduplică prin event_uid), nu sărim peste ce n-am apucat.
		const truncated = !!lastResp?.hasMore && events.length > 0;
		if (truncated) errors.push('citire incompletă: continuă la următoarea citire');
		const pulledAt = truncated ? (safeDate(events[events.length - 1]?.t) ?? now) : now;

		// Doar evenimentele noi: suprapunerea de 1 h le retrimite pe cele deja salvate.
		const stored = await storedUids(site.id, [...new Set(events.map((e) => e.id))]);
		const seen = new Set<string>();
		const fresh = events.filter((e) => {
			if (!e.id || stored.has(e.id) || seen.has(e.id)) return false;
			if (Number.isNaN(Date.parse(e.t))) return false;
			seen.add(e.id);
			return true;
		});

		const { findings, nextState, levels } = detectFindings({ events: fresh, scan, state, now });

		// Retenția (SENTINEL_RETENTION_DAYS): nu inserăm evenimente pe care jobul zilnic le-ar
		// purja oricum — dar tot au trecut prin detectFindings mai sus (baseline-ul are nevoie de ele).
		let insertedCount = 0;
		for (let i = 0; i < fresh.length; i += INSERT_CHUNK) {
			const rows = fresh
				.slice(i, i + INSERT_CHUNK)
				.filter((e) => now.getTime() - new Date(e.t).getTime() <= RETENTION_MS)
				.map((e) => ({
					id: newId(),
					tenantId: site.tenantId,
					siteId: site.id,
					eventUid: e.id,
					occurredAt: new Date(e.t),
					sentinelSev: e.sev,
					level: levels.get(e.id) ?? 'normal',
					event: e.ev,
					username: e.user !== '-' ? e.user : typeof e.date?.login === 'string' ? e.date.login : null,
					ip: e.ip || null,
					uri: e.uri || null,
					userAgent: e.ua || null,
					data: JSON.stringify(e.date ?? {})
				}));
			if (rows.length > 0) {
				await db.insert(table.wordpressSecurityEvent).values(rows).onConflictDoNothing();
				insertedCount += rows.length;
			}
		}

		const status: PullStatus = legacy ? 'legacy' : 'ok';
		nextState.pendingFindings = [...state.pendingFindings, ...findings].slice(-MAX_PENDING);
		nextState.lastError = errors.length ? errors.join('; ') : null;
		await db
			.update(table.wordpressSite)
			.set({
				sentinelLastPullAt: pulledAt,
				sentinelLastPullStatus: status,
				sentinelFailures: 0,
				sentinelState: JSON.stringify({ ...nextState, lastFailureDay }),
				updatedAt: now
			})
			.where(eq(table.wordpressSite.id, site.id));

		logInfo(
			'wordpress',
			`Sentinel ${site.siteUrl}: ${fresh.length} evenimente noi (${events.length} primite), ${findings.length} findings${legacy ? ', mu-plugin vechi prezent' : ''}${truncated ? ', citire trunchiată' : ''}`,
			{
				tenantId: site.tenantId,
				metadata: {
					siteId: site.id,
					trigger,
					findings: findings.map((f) => f.kind),
					scan: scan ? { files: scan.files.length, truncated: scan.truncated } : null,
					truncated,
					errors
				}
			}
		);

		return {
			...base,
			status,
			inserted: insertedCount,
			findings,
			pending: nextState.pendingFindings,
			failures: 0,
			scan: scan ? { files: scan.files.length, scannedFiles: scan.scannedFiles, truncated: scan.truncated } : undefined
		};
	} catch (err) {
		const { message } = serializeError(err);
		const { failures, lastFailureDay: newDay } = nextDailyFailure(trigger, site.sentinelFailures ?? 0, lastFailureDay, now);
		await db
			.update(table.wordpressSite)
			.set({
				sentinelLastPullStatus: 'error',
				...(trigger === 'daily' ? { sentinelFailures: failures } : {}),
				sentinelState: JSON.stringify({ ...state, lastError: message, lastFailureDay: newDay }),
				updatedAt: now
			})
			.where(eq(table.wordpressSite.id, site.id));
		logWarning('wordpress', `Sentinel FAILED ${site.siteUrl} (${trigger}): ${message}`, {
			tenantId: site.tenantId,
			metadata: { siteId: site.id, failures }
		});
		return { ...base, status: 'error', failures, error: message };
	}
}
