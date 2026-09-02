// Teste pentru providerul DataForSEO — parser pe fixture + apel cu fetch fals.
import { describe, test, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
	parseDataforseoResponse,
	fetchSerpDataforseo,
	type DataforseoCreds
} from '../dataforseo';
import { SerpProviderError, type SerpQuery } from '../types';

const fixture = JSON.parse(
	readFileSync(new URL('./fixtures/dataforseo-serp.json', import.meta.url), 'utf8')
);

const creds: DataforseoCreds = { login: 'user@x.ro', password: 'secret' };
const q: SerpQuery = {
	keyword: 'ce este optimizarea seo',
	device: 'desktop',
	googleDomain: 'google.ro',
	hl: 'ro',
	gl: 'ro',
	location: '',
	depth: 100
};

describe('parseDataforseoResponse', () => {
	const r = parseDataforseoResponse(fixture, { targetDomain: 'example.ro' });

	test('extrage doar rezultatele organice, în ordine, cu poziții 1..n', () => {
		expect(r.organic.map((o) => o.position)).toEqual([1, 2, 3, 4]);
		expect(r.organic[0].domain).toBe('moz.com');
		expect(r.organic[1].domain).toBe('competitor-a.ro');
		expect(r.organic[3].domain).toBe('example.ro');
	});

	test('titlu + descriere mapate din câmpurile DataForSEO', () => {
		expect(r.organic[0].title).toContain('Moz');
		expect(r.organic[0].snippet).toContain('get started with SEO');
	});

	test('features din tipurile de item: ads (paid), ai, paa, local', () => {
		expect(r.features).toEqual(expect.arrayContaining(['ads', 'ai', 'paa', 'local']));
	});

	test("aiOverview 'cited' când ținta e în referințele blocului AI", () => {
		expect(r.aiOverview).toBe('cited');
	});

	test("aiOverview 'present' când ținta nu e sursă", () => {
		const r2 = parseDataforseoResponse(fixture, { targetDomain: 'inexistent.ro' });
		expect(r2.aiOverview).toBe('present');
	});

	test('răspuns gol → organic [], fără să arunce', () => {
		expect(parseDataforseoResponse({}, { targetDomain: 'example.ro' }).organic).toEqual([]);
		expect(parseDataforseoResponse({ tasks: [] }, { targetDomain: 'example.ro' }).aiOverview).toBe(
			'absent'
		);
	});
});

describe('fetchSerpDataforseo — rețea', () => {
	test('200 → SerpResult parsat; body conține keyword, device, location_name', async () => {
		let sentBody: string | undefined;
		const r = await fetchSerpDataforseo(q, 'example.ro', creds, {
			fetch: (async (_url: string, init: RequestInit) => {
				sentBody = init.body as string;
				return new Response(JSON.stringify(fixture), { status: 200 });
			}) as unknown as typeof fetch
		});
		expect(r.organic.length).toBe(4);
		const parsed = JSON.parse(sentBody!)[0];
		expect(parsed.keyword).toBe(q.keyword);
		expect(parsed.device).toBe('desktop');
		expect(parsed.location_name).toBe('Romania'); // derivat din gl=ro
		expect(parsed.language_code).toBe('ro');
	});

	test('401/402 → SerpProviderError config, neretryable', async () => {
		for (const status of [401, 402]) {
			let err: unknown;
			try {
				await fetchSerpDataforseo(q, 'example.ro', creds, {
					fetch: (async () => new Response('', { status })) as unknown as typeof fetch
				});
			} catch (e) {
				err = e;
			}
			expect((err as SerpProviderError).kind).toBe('config');
			expect((err as SerpProviderError).retryable).toBe(false);
		}
	});

	test('500 → SerpProviderError network, retryable', async () => {
		let err: unknown;
		try {
			await fetchSerpDataforseo(q, 'example.ro', creds, {
				fetch: (async () => new Response('', { status: 500 })) as unknown as typeof fetch
			});
		} catch (e) {
			err = e;
		}
		expect((err as SerpProviderError).kind).toBe('network');
		expect((err as SerpProviderError).retryable).toBe(true);
	});

	test('timeout → SerpProviderError timeout, retryable', async () => {
		let err: unknown;
		try {
			await fetchSerpDataforseo(q, 'example.ro', creds, {
				fetch: (async () => {
					const e = new Error('The operation timed out');
					e.name = 'TimeoutError';
					throw e;
				}) as unknown as typeof fetch
			});
		} catch (e) {
			err = e;
		}
		expect((err as SerpProviderError).kind).toBe('timeout');
		expect((err as SerpProviderError).retryable).toBe(true);
	});

	test('folosește locația explicită când e dată', async () => {
		let sentBody: string | undefined;
		await fetchSerpDataforseo({ ...q, location: 'București,România' }, 'example.ro', creds, {
			fetch: (async (_url: string, init: RequestInit) => {
				sentBody = init.body as string;
				return new Response(JSON.stringify(fixture), { status: 200 });
			}) as unknown as typeof fetch
		});
		expect(JSON.parse(sentBody!)[0].location_name).toBe('București,România');
	});
});
