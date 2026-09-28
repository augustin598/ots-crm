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
import { loadSiteAndClient } from '../sync';
import { compareConnectorVersions } from '../connector-release';
import { logInfo, logWarning, serializeError } from '$lib/server/logger';
import { detectFindings } from './rules';
import { parseState, type Finding, type SentinelEvent, type SentinelScan } from './types';

export const SENTINEL_MIN_CONNECTOR = '0.9.0';
/** Suprapunere cu citirea anterioară (ceasuri decalate, rotiri); evenimentele deja salvate se filtrează. */
const OVERLAP_MS = 60 * 60 * 1000;
const MAX_PAGES = 20;
const INSERT_CHUNK = 100;
const LOOKUP_CHUNK = 500; // limita de parametri SQLite
const MAX_PENDING = 200;

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

export async function pullSite(
	siteId: string,
	opts: { now?: Date; trigger: PullTrigger }
): Promise<PullResult> {
	const now = opts.now ?? new Date();
	const { site, client } = await loadSiteAndClient(siteId);
	const state = parseState(site.sentinelState);
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
		for (let pageNo = 0; pageNo < MAX_PAGES; pageNo++) {
			const resp = await client.sentinel({ since, skip: events.length }, { siteId: site.id });
			if (!resp || !Array.isArray(resp.events)) throw new Error('Răspuns Sentinel invalid');
			events.push(...resp.events);
			if (pageNo === 0) {
				scan = resp.scan ?? null;
				legacy = resp.sentinel?.legacyMuPlugin === true;
			}
			errors.push(...(resp.errors ?? []));
			if (!resp.hasMore || resp.events.length === 0) break;
		}

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

		for (let i = 0; i < fresh.length; i += INSERT_CHUNK) {
			const rows = fresh.slice(i, i + INSERT_CHUNK).map((e) => ({
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
			await db.insert(table.wordpressSecurityEvent).values(rows).onConflictDoNothing();
		}

		const status: PullStatus = legacy ? 'legacy' : 'ok';
		nextState.pendingFindings = [...state.pendingFindings, ...findings].slice(-MAX_PENDING);
		nextState.lastError = errors.length ? errors.join('; ') : null;
		await db
			.update(table.wordpressSite)
			.set({
				sentinelLastPullAt: now,
				sentinelLastPullStatus: status,
				sentinelFailures: 0,
				sentinelState: JSON.stringify(nextState),
				updatedAt: now
			})
			.where(eq(table.wordpressSite.id, site.id));

		logInfo(
			'wordpress',
			`Sentinel ${site.siteUrl}: ${fresh.length} evenimente noi (${events.length} primite), ${findings.length} findings${legacy ? ', mu-plugin vechi prezent' : ''}`,
			{
				tenantId: site.tenantId,
				metadata: {
					siteId: site.id,
					trigger: opts.trigger,
					findings: findings.map((f) => f.kind),
					scan: scan ? { files: scan.files.length, truncated: scan.truncated } : null,
					errors
				}
			}
		);

		return {
			...base,
			status,
			inserted: fresh.length,
			findings,
			pending: nextState.pendingFindings,
			failures: 0,
			scan: scan ? { files: scan.files.length, scannedFiles: scan.scannedFiles, truncated: scan.truncated } : undefined
		};
	} catch (err) {
		const { message } = serializeError(err);
		const failures = opts.trigger === 'daily' ? (site.sentinelFailures ?? 0) + 1 : (site.sentinelFailures ?? 0);
		await db
			.update(table.wordpressSite)
			.set({
				sentinelLastPullStatus: 'error',
				...(opts.trigger === 'daily' ? { sentinelFailures: failures } : {}),
				sentinelState: JSON.stringify({ ...state, lastError: message }),
				updatedAt: now
			})
			.where(eq(table.wordpressSite.id, site.id));
		logWarning('wordpress', `Sentinel FAILED ${site.siteUrl} (${opts.trigger}): ${message}`, {
			tenantId: site.tenantId,
			metadata: { siteId: site.id, failures }
		});
		return { ...base, status: 'error', failures, error: message };
	}
}
