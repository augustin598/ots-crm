import { describe, test, expect } from 'bun:test';
import { describeCachePurge, requestCachePurge } from '../wordpress-cache-purge';

type Call = { url: string; method?: string; body?: unknown };
function fakeFetch(status: number, body: unknown, calls: Call[] = []): typeof fetch {
	return (async (url: string, init?: RequestInit) => {
		calls.push({ url, method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : null });
		return new Response(JSON.stringify(body), { status });
	}) as unknown as typeof fetch;
}

describe('requestCachePurge', () => {
	test('POST cache-purge (scope update implicit) și întoarce rezultatul serverului', async () => {
		const calls: Call[] = [];
		const outcome = {
			status: 'purged' as const,
			items: [{ id: 'litespeed', name: 'LiteSpeed Cache', ok: true }]
		};
		const r = await requestCachePurge('/ots/api/wordpress/sites/s1', {
			fetchFn: fakeFetch(200, outcome, calls)
		});
		expect(calls).toEqual([
			{ url: '/ots/api/wordpress/sites/s1/cache-purge', method: 'POST', body: { scope: 'update' } }
		]);
		expect(r).toEqual(outcome);
	});

	test('HTTP de eroare → failed cu mesajul serverului', async () => {
		const r = await requestCachePurge('/b', {
			fetchFn: fakeFetch(502, { status: 'failed', error: 'HTTP 500 de la site' })
		});
		expect(r).toEqual({ status: 'failed', error: 'HTTP 500 de la site' });
	});

	test('eroare de rețea → failed, nu excepție', async () => {
		const boom = (async () => {
			throw new Error('fetch failed');
		}) as unknown as typeof fetch;
		expect(await requestCachePurge('/b', { fetchFn: boom })).toEqual({
			status: 'failed',
			error: 'fetch failed'
		});
	});
});

describe('describeCachePurge', () => {
	test('golite toate → ok, cu numele lor', () => {
		expect(
			describeCachePurge({
				status: 'purged',
				items: [
					{ id: 'litespeed', name: 'LiteSpeed Cache', ok: true },
					{ id: 'elementor', name: 'Elementor (CSS)', ok: true }
				]
			})
		).toEqual({ text: 'Cache golit: LiteSpeed Cache, Elementor (CSS)', tone: 'ok' });
	});

	test('unul a eșuat → warning cu motivul', () => {
		expect(
			describeCachePurge({
				status: 'purged',
				items: [
					{ id: 'litespeed', name: 'LiteSpeed Cache', ok: true },
					{ id: 'perfmatters', name: 'Perfmatters (CSS folosit)', ok: false, error: 'metodă lipsă' }
				]
			})
		).toEqual({
			text: 'Cache golit: LiteSpeed Cache · negolit: Perfmatters (CSS folosit) (metodă lipsă)',
			tone: 'warning'
		});
	});

	test('fără plugin de cache → muted', () => {
		expect(describeCachePurge({ status: 'nothing' })).toEqual({
			text: 'Niciun cache de golit pe site',
			tone: 'muted'
		});
	});

	test('conector vechi → warning cu versiunea', () => {
		expect(describeCachePurge({ status: 'unsupported', connectorVersion: '0.8.3' })).toEqual({
			text: 'Cache-ul NU a fost golit: conectorul v0.8.3 nu știe să-l golească (actualizează conectorul)',
			tone: 'warning'
		});
	});

	test('eșec → warning', () => {
		expect(describeCachePurge({ status: 'failed', error: 'HTTP 500' })).toEqual({
			text: 'Golirea cache-ului a eșuat: HTTP 500',
			tone: 'warning'
		});
	});
});
