/**
 * Browser side of the WordPress backup / restore. With OTS Connector ≥ 0.8.0
 * the work is chunked: the first call starts the job and each `/step` call
 * advances it for ~20 s, so this loops until the server says `success` or
 * `failed`. Older connectors answer the first call synchronously and the loop
 * never starts. Shared by the sites list, the plugins page and the plugin
 * library (pre-update backups).
 */
import { requestCachePurge, type CachePurgeOutcome } from './wordpress-cache-purge';

type BackupJobProgress = {
	tablesDone: number;
	tablesTotal: number;
	filesDone: number;
	filesTotal: number;
	bytesDone: number;
	bytesTotal: number;
};
type RestoreJobProgress = {
	dbPart: number;
	dbParts: number;
	filePart: number;
	fileParts: number;
	statements: number;
	filesWritten: number;
};

export type BackupRunProgress = {
	phase?: string;
	progress?: BackupJobProgress | RestoreJobProgress;
	sizeBytes?: number;
	/** Consecutive transport failures being retried. */
	retrying?: number;
	error?: string;
};

type RunOpts = {
	onProgress?: (p: BackupRunProgress) => void;
	fetchFn?: typeof fetch;
	sleep?: (ms: number) => Promise<void>;
	/** Consecutive retryable failures tolerated before giving up. */
	maxRetries?: number;
};

type StepBody = BackupRunProgress & {
	status?: 'running' | 'success' | 'failed';
	backupId?: string;
	retryable?: boolean;
	error?: string;
};

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function post(fetchFn: typeof fetch, url: string, body: object): Promise<{ ok: boolean; status: number; body: StepBody }> {
	const res = await fetchFn(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});
	return { ok: res.ok, status: res.status, body: ((await res.json().catch(() => ({}))) ?? {}) as StepBody };
}

/**
 * Keep calling `stepUrl` until the job ends. Network errors and `retryable`
 * answers are retried with a growing pause; after `maxRetries` in a row the
 * optional `abandon` hook records why and the run fails.
 */
async function loopSteps(
	stepUrl: string,
	opts: RunOpts,
	abandon?: (error: string) => Promise<StepBody>
): Promise<{ ok: true; body: StepBody } | { ok: false; error: string }> {
	const fetchFn = opts.fetchFn ?? fetch;
	const sleep = opts.sleep ?? defaultSleep;
	const maxRetries = opts.maxRetries ?? 5;
	let failures = 0;
	for (;;) {
		let reply: { ok: boolean; status: number; body: StepBody };
		try {
			reply = await post(fetchFn, stepUrl, {});
		} catch (err) {
			reply = {
				ok: false,
				status: 0,
				body: { status: 'running', retryable: true, error: err instanceof Error ? err.message : 'eroare de rețea' }
			};
		}
		const b = reply.body;
		if (b.status === 'success') return { ok: true, body: b };
		if (b.status === 'failed' || (!reply.ok && reply.status !== 0 && !b.retryable)) {
			return { ok: false, error: b.error || `HTTP ${reply.status}` };
		}
		if (b.retryable) {
			failures++;
			const error = b.error ?? 'eroare de rețea';
			if (failures > maxRetries) {
				if (abandon) {
					const a = await abandon(error).catch(() => ({ error }) as StepBody);
					return { ok: false, error: a.error || error };
				}
				return { ok: false, error };
			}
			opts.onProgress?.({ retrying: failures, error });
			await sleep(3000 * failures);
			continue;
		}
		failures = 0;
		opts.onProgress?.({ phase: b.phase, progress: b.progress, sizeBytes: b.sizeBytes });
	}
}

export async function runSiteBackup(
	siteApi: string,
	opts: RunOpts & { trigger: 'manual' | 'pre_update' }
): Promise<{ ok: true; backupId: string; sizeBytes?: number } | { ok: false; backupId?: string; error: string }> {
	const fetchFn = opts.fetchFn ?? fetch;
	let first: { ok: boolean; status: number; body: StepBody };
	try {
		first = await post(fetchFn, `${siteApi}/backup`, { trigger: opts.trigger });
	} catch (err) {
		return { ok: false, error: err instanceof Error ? err.message : 'eroare de rețea' };
	}
	const backupId = first.body.backupId;
	if (!first.ok || first.body.status === 'failed' || !backupId) {
		return { ok: false, backupId, error: first.body.error || `HTTP ${first.status}` };
	}
	if (first.body.status === 'success') {
		return { ok: true, backupId, sizeBytes: first.body.sizeBytes };
	}
	opts.onProgress?.({ phase: first.body.phase, progress: first.body.progress, sizeBytes: first.body.sizeBytes });
	return continueSiteBackup(siteApi, backupId, opts);
}

/** Resume a chunked backup left `running` (tab closed, lost connection). */
export async function continueSiteBackup(
	siteApi: string,
	backupId: string,
	opts: RunOpts = {}
): Promise<{ ok: true; backupId: string; sizeBytes?: number } | { ok: false; backupId?: string; error: string }> {
	const fetchFn = opts.fetchFn ?? fetch;
	const stepUrl = `${siteApi}/backups/${backupId}/step`;
	const r = await loopSteps(stepUrl, opts, async (error) =>
		(await post(fetchFn, stepUrl, { abandon: true, error })).body
	);
	return r.ok ? { ok: true, backupId, sizeBytes: r.body.sizeBytes } : { ok: false, backupId, error: r.error };
}

export async function runSiteRestore(
	siteApi: string,
	backupId: string,
	opts: RunOpts = {}
): Promise<{ ok: true; cache: CachePurgeOutcome } | { ok: false; error: string }> {
	const fetchFn = opts.fetchFn ?? fetch;
	// Pages cached before the restore show the replaced content; empty the
	// caches (object cache + OPcache too) in a request of its own, so a slow
	// purge cannot turn a completed restore into a gateway timeout.
	const done = async () => {
		opts.onProgress?.({ phase: 'cache' });
		return { ok: true as const, cache: await requestCachePurge(siteApi, { scope: 'restore', fetchFn }) };
	};
	let first: { ok: boolean; status: number; body: StepBody };
	try {
		first = await post(fetchFn, `${siteApi}/backups/${backupId}/restore`, {});
	} catch (err) {
		return { ok: false, error: err instanceof Error ? err.message : 'eroare de rețea' };
	}
	if (!first.ok || first.body.status === 'failed') {
		return { ok: false, error: first.body.error || `HTTP ${first.status}` };
	}
	if (first.body.status === 'success') return done();
	opts.onProgress?.({ phase: first.body.phase, progress: first.body.progress });

	const r = await loopSteps(`${siteApi}/backups/${backupId}/restore/step`, opts);
	return r.ok ? done() : { ok: false, error: r.error };
}

function mb(bytes: number): string {
	return `${Math.round(bytes / 1024 / 1024)} MB`;
}

/** One line of Romanian for the progress area. */
export function describeBackupProgress(p: BackupRunProgress): string {
	if (p.retrying) return `Reîncerc (${p.retrying}) după: ${p.error ?? 'eroare'}`;
	if (p.phase === 'cache') return 'Golesc cache-ul site-ului…';
	const pr = p.progress;
	if (!pr) return 'Pornesc…';
	if ('tablesTotal' in pr) {
		if (p.phase === 'db') return `Baza de date: ${pr.tablesDone}/${pr.tablesTotal} tabele`;
		if (p.phase === 'scan') return 'Listez fișierele…';
		return `Fișiere: ${pr.filesDone}/${pr.filesTotal} (${mb(pr.bytesDone)} din ${mb(pr.bytesTotal)})`;
	}
	if (p.phase === 'db') return `Restaurare bază de date: partea ${pr.dbPart}/${pr.dbParts}`;
	return `Restaurare fișiere: partea ${pr.filePart}/${pr.fileParts} (${pr.filesWritten} fișiere)`;
}

/**
 * Overall completion for the progress bar, or null before the first report.
 * Backup: database = first 20 %, files = the rest by bytes copied. Restore:
 * database parts = first half, file parts = second half (a part is only
 * counted once finished, so the bar never runs ahead of the work).
 */
export function backupProgressPercent(p: BackupRunProgress): number | null {
	const pr = p.progress;
	if (!pr) return null;
	if ('tablesTotal' in pr) {
		if (p.phase === 'finalize' || p.phase === 'done') return 99;
		if (p.phase === 'db') return Math.round((pr.tablesTotal ? pr.tablesDone / pr.tablesTotal : 0) * 20);
		if (p.phase === 'scan' || !pr.bytesTotal) return 20;
		return Math.round(20 + (pr.bytesDone / pr.bytesTotal) * 80);
	}
	if (p.phase === 'large' || p.phase === 'done') return 98;
	if (p.phase === 'db') return Math.round(((pr.dbPart - 1) / Math.max(1, pr.dbParts)) * 50);
	return Math.round(50 + ((pr.filePart - 1) / Math.max(1, pr.fileParts)) * 50);
}

/** What the progress banner shows; see WpJobProgress.svelte. */
export type JobView = { text: string; percent: number | null; tone: 'default' | 'warning' };

/**
 * Next banner state from a progress report. A retry keeps the previous
 * percentage (the bar must not jump back to 0) and turns the banner amber.
 */
export function nextJobView(prev: JobView | null, p: BackupRunProgress, prefix = ''): JobView {
	return {
		text: prefix + describeBackupProgress(p),
		percent: backupProgressPercent(p) ?? prev?.percent ?? null,
		tone: p.retrying ? 'warning' : 'default'
	};
}
