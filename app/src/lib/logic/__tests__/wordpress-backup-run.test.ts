import { describe, test, expect } from 'bun:test';
import { runSiteBackup, runSiteRestore, describeBackupProgress, backupProgressPercent } from '../wordpress-backup-run';

type Reply = { status?: number; body?: unknown; throws?: boolean };
function fakeFetch(replies: Reply[], calls: Array<{ url: string; body: unknown }> = []): typeof fetch {
	let i = 0;
	return (async (url: string, init?: RequestInit) => {
		calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
		const r = replies[i++] ?? { status: 500, body: { error: 'no more replies' } };
		if (r.throws) throw new Error('offline');
		return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200 });
	}) as unknown as typeof fetch;
}
const noSleep = async () => {};

describe('runSiteBackup', () => {
	test('conector vechi: răspunsul sincron success încheie tot', async () => {
		const calls: Array<{ url: string; body: unknown }> = [];
		const r = await runSiteBackup('/api/s1', {
			trigger: 'pre_update',
			fetchFn: fakeFetch([{ body: { backupId: 'b1', status: 'success', sizeBytes: 10 } }], calls),
			sleep: noSleep
		});
		expect(r).toEqual({ ok: true, backupId: 'b1', sizeBytes: 10 });
		expect(calls[0]).toEqual({ url: '/api/s1/backup', body: { trigger: 'pre_update' } });
	});

	test('pe pași: continuă cu /step până la success și raportează progresul', async () => {
		const calls: Array<{ url: string; body: unknown }> = [];
		const seen: string[] = [];
		const r = await runSiteBackup('/api/s1', {
			trigger: 'manual',
			fetchFn: fakeFetch(
				[
					{ body: { backupId: 'b1', status: 'running', phase: 'db' } },
					{ body: { status: 'running', phase: 'files' } },
					{ body: { status: 'success', sizeBytes: 99 } }
				],
				calls
			),
			sleep: noSleep,
			onProgress: (p) => seen.push(p.phase ?? '')
		});
		expect(r).toEqual({ ok: true, backupId: 'b1', sizeBytes: 99 });
		expect(calls.map((c) => c.url)).toEqual(['/api/s1/backup', '/api/s1/backups/b1/step', '/api/s1/backups/b1/step']);
		expect(seen).toEqual(['db', 'files']);
	});

	test('erori de transport: reîncearcă, iar după prea multe abandonează explicit', async () => {
		const calls: Array<{ url: string; body: unknown }> = [];
		const r = await runSiteBackup('/api/s1', {
			trigger: 'manual',
			maxRetries: 2,
			fetchFn: fakeFetch(
				[
					{ body: { backupId: 'b1', status: 'running' } },
					{ body: { status: 'running', retryable: true, error: 'HTTP 503' } },
					{ throws: true },
					{ body: { status: 'running', retryable: true, error: 'HTTP 503' } },
					{ body: { status: 'failed', error: 'abandonat: HTTP 503' } }
				],
				calls
			),
			sleep: noSleep
		});
		expect(r).toEqual({ ok: false, backupId: 'b1', error: 'abandonat: HTTP 503' });
		expect(calls.at(-1)).toEqual({ url: '/api/s1/backups/b1/step', body: { abandon: true, error: 'HTTP 503' } });
	});

	test('o reușită între erori resetează numărătoarea', async () => {
		const r = await runSiteBackup('/api/s1', {
			trigger: 'manual',
			maxRetries: 1,
			fetchFn: fakeFetch([
				{ body: { backupId: 'b1', status: 'running' } },
				{ body: { status: 'running', retryable: true, error: 'x' } },
				{ body: { status: 'running', phase: 'files' } },
				{ body: { status: 'running', retryable: true, error: 'x' } },
				{ body: { status: 'success', sizeBytes: 1 } }
			]),
			sleep: noSleep
		});
		expect(r.ok).toBe(true);
	});

	test('start eșuat → eroarea serverului', async () => {
		const r = await runSiteBackup('/api/s1', {
			trigger: 'manual',
			fetchFn: fakeFetch([{ status: 502, body: { backupId: 'b1', status: 'failed', error: 'HMAC rejected' } }]),
			sleep: noSleep
		});
		expect(r).toEqual({ ok: false, backupId: 'b1', error: 'HMAC rejected' });
	});
});

describe('runSiteRestore', () => {
	test('pe pași până la success', async () => {
		const calls: Array<{ url: string; body: unknown }> = [];
		const r = await runSiteRestore('/api/s1', 'b1', {
			fetchFn: fakeFetch(
				[{ body: { status: 'running', phase: 'db' } }, { body: { status: 'success' } }],
				calls
			),
			sleep: noSleep
		});
		expect(r).toEqual({ ok: true });
		expect(calls.map((c) => c.url)).toEqual(['/api/s1/backups/b1/restore', '/api/s1/backups/b1/restore/step']);
	});

	test('eșec → eroarea', async () => {
		const r = await runSiteRestore('/api/s1', 'b1', {
			fetchFn: fakeFetch([{ status: 502, body: { status: 'failed', error: 'verificare eșuată' } }]),
			sleep: noSleep
		});
		expect(r).toEqual({ ok: false, error: 'verificare eșuată' });
	});
});

describe('describeBackupProgress', () => {
	test('faze de backup și restore', () => {
		expect(describeBackupProgress({ phase: 'db', progress: { tablesDone: 3, tablesTotal: 14, filesDone: 0, filesTotal: 0, bytesDone: 0, bytesTotal: 0 } })).toBe('Baza de date: 3/14 tabele');
		expect(describeBackupProgress({ phase: 'files', progress: { tablesDone: 14, tablesTotal: 14, filesDone: 2399, filesTotal: 6971, bytesDone: 128 * 1024 * 1024, bytesTotal: 355 * 1024 * 1024 } })).toBe('Fișiere: 2399/6971 (128 MB din 355 MB)');
		expect(describeBackupProgress({ phase: 'db', progress: { dbPart: 1, dbParts: 3, filePart: 1, fileParts: 6, statements: 900, filesWritten: 0 } })).toBe('Restaurare bază de date: partea 1/3');
		expect(describeBackupProgress({ phase: 'files', progress: { dbPart: 3, dbParts: 3, filePart: 2, fileParts: 6, statements: 900, filesWritten: 800 } })).toBe('Restaurare fișiere: partea 2/6 (800 fișiere)');
		expect(describeBackupProgress({ retrying: 2, error: 'HTTP 503' })).toBe('Reîncerc (2) după: HTTP 503');
		expect(describeBackupProgress({})).toBe('Pornesc…');
	});
});

describe('backupProgressPercent', () => {
	const bp = (phase: string, o: Partial<{ tablesDone: number; tablesTotal: number; filesDone: number; filesTotal: number; bytesDone: number; bytesTotal: number }>) => ({
		phase,
		progress: { tablesDone: 0, tablesTotal: 10, filesDone: 0, filesTotal: 0, bytesDone: 0, bytesTotal: 0, ...o }
	});
	test('backup: baza = primele 20%, fișierele după octeți', () => {
		expect(backupProgressPercent({})).toBeNull();
		expect(backupProgressPercent(bp('db', { tablesDone: 5 }))).toBe(10);
		expect(backupProgressPercent(bp('scan', { tablesDone: 10 }))).toBe(20);
		expect(backupProgressPercent(bp('files', { tablesDone: 10, bytesDone: 50, bytesTotal: 100 }))).toBe(60);
		expect(backupProgressPercent(bp('finalize', { tablesDone: 10, bytesDone: 100, bytesTotal: 100 }))).toBe(99);
		expect(backupProgressPercent(bp('files', { tablesDone: 10, bytesDone: 0, bytesTotal: 0 }))).toBe(20);
	});
	test('restore: baza = prima jumătate, fișierele a doua', () => {
		const rp = (phase: string, dbPart: number, filePart: number) => ({
			phase,
			progress: { dbPart, dbParts: 4, filePart, fileParts: 10, statements: 0, filesWritten: 0 }
		});
		expect(backupProgressPercent(rp('db', 1, 1))).toBe(0);
		expect(backupProgressPercent(rp('db', 3, 1))).toBe(25);
		expect(backupProgressPercent(rp('files', 4, 6))).toBe(75);
		expect(backupProgressPercent(rp('large', 4, 10))).toBe(98);
	});
});
