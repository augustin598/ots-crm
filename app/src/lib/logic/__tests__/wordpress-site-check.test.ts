import { describe, test, expect } from 'bun:test';
import { describeSiteCheck, requestSiteCheck } from '../wordpress-site-check';

describe('requestSiteCheck', () => {
	test('POST site-check și întoarce rezultatul', async () => {
		const calls: string[] = [];
		const outcome = { ok: true, pages: [{ label: 'Homepage', url: 'https://x.ro/', status: 200, ms: 800, problem: null }] };
		const fetchFn = (async (url: string, init?: RequestInit) => {
			calls.push(`${init?.method} ${url}`);
			return new Response(JSON.stringify(outcome), { status: 200 });
		}) as unknown as typeof fetch;
		expect(await requestSiteCheck('/ots/api/wordpress/sites/s1', { fetchFn })).toEqual(outcome);
		expect(calls).toEqual(['POST /ots/api/wordpress/sites/s1/site-check']);
	});

	test('eroare de server sau rețea → rezultat „necunoscut", nu excepție', async () => {
		const bad = (async () => new Response(JSON.stringify({ error: 'Nu a fost găsit' }), { status: 404 })) as unknown as typeof fetch;
		expect(await requestSiteCheck('/b', { fetchFn: bad })).toEqual({ ok: null, error: 'Nu a fost găsit', pages: [] });
		const boom = (async () => {
			throw new Error('offline');
		}) as unknown as typeof fetch;
		expect(await requestSiteCheck('/b', { fetchFn: boom })).toEqual({ ok: null, error: 'offline', pages: [] });
	});
});

describe('describeSiteCheck', () => {
	test('toate paginile ok → ok, cu codul și timpul fiecăreia', () => {
		expect(
			describeSiteCheck({
				ok: true,
				pages: [
					{ label: 'Homepage', url: 'https://x.ro/', status: 200, ms: 1234, problem: null },
					{ label: 'Produs', url: 'https://x.ro/p/', status: 200, ms: 800, problem: null }
				]
			})
		).toEqual({ text: 'Site online: Homepage 200 (1,2 s) · Produs 200 (0,8 s)', tone: 'ok' });
	});

	test('o pagină picată → error, cu pagina și motivul', () => {
		expect(
			describeSiteCheck({
				ok: false,
				pages: [
					{ label: 'Homepage', url: 'https://x.ro/', status: 500, ms: 400, problem: 'eroare critică PHP' },
					{ label: 'Produs', url: 'https://x.ro/p/', status: 200, ms: 800, problem: null }
				]
			})
		).toEqual({
			text: 'Site cu probleme după update: Homepage (https://x.ro/) — eroare critică PHP · Produs 200 (0,8 s)',
			tone: 'error'
		});
	});

	test('check-ul n-a putut rula → warning', () => {
		expect(describeSiteCheck({ ok: null, error: 'offline', pages: [] })).toEqual({
			text: 'Nu am putut verifica site-ul: offline',
			tone: 'warning'
		});
	});
});
