/**
 * Chunked backup / restore (OTS Connector ≥ 0.8.0).
 *
 * Shared hosts cut a request after 30 s – 2 min (HTTP 500/503) or re-send it,
 * which then fails the connector's 60 s HMAC window (HTTP 401): every
 * one-shot backup of a real site failed that way (heylux, stropuva,
 * centrale-seminee, heyluxsuceava). The connector now does ~10 s of work per
 * call and keeps a cursor on disk; the CRM endpoints run a few such steps
 * per request (≤ ~20 s) and the browser keeps calling until done.
 */
import { compareConnectorVersions } from './connector-release';
import { WpError } from './errors';

export const CHUNKED_BACKUP_MIN_CONNECTOR = '0.8.0';

/** Seconds of work the connector does per step (its own default too). */
export const STEP_BUDGET_SEC = 10;

/** How long one CRM request keeps stepping before handing back to the browser. */
export const CRM_REQUEST_MAX_MS = 20_000;

export function supportsChunkedBackup(connectorVersion: string | null | undefined): boolean {
	return (
		!!connectorVersion &&
		compareConnectorVersions(connectorVersion, CHUNKED_BACKUP_MIN_CONNECTOR) >= 0
	);
}

/** Directory name the connector gives a chunked backup (legacy backups are `ots-backup-<ts>.zip`). */
export function isChunkedBackupName(name: string): boolean {
	return /^ots-backup-\d{8}-\d{6}-[a-z0-9]{8}$/.test(name);
}

/**
 * A step that failed on the transport can simply be sent again: the job
 * resumes from its last saved cursor. A 401 is included because a proxy
 * that re-sends a request past the HMAC window produces exactly that.
 */
export function isRetryableWpError(err: unknown): boolean {
	if (!WpError.isWpError(err)) return false;
	return (
		err.code === 'wp_connection_error' ||
		err.code === 'wp_site_down' ||
		err.code === 'wp_auth_error'
	);
}

/**
 * Call `step` until it reports `done` or the next step would not fit in
 * `maxMs`. `busy` (another step of the same job holds the lock) waits 2 s
 * and asks again.
 */
export async function driveSteps<T extends { done?: boolean; busy?: boolean }>(
	step: () => Promise<T>,
	opts: {
		maxMs?: number;
		stepEstimateMs?: number;
		now?: () => number;
		sleep?: (ms: number) => Promise<void>;
	} = {}
): Promise<T> {
	const maxMs = opts.maxMs ?? CRM_REQUEST_MAX_MS;
	const estimate = opts.stepEstimateMs ?? (STEP_BUDGET_SEC + 2) * 1000;
	const now = opts.now ?? (() => Date.now());
	const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
	const started = now();
	for (;;) {
		const result = await step();
		if (result.done) return result;
		if (result.busy) await sleep(2000);
		if (now() - started + estimate > maxMs) return result;
	}
}
