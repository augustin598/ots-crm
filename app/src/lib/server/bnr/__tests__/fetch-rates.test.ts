import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test';

mock.module('$lib/server/db', () => ({ db: {} }));
mock.module('$lib/server/db/schema', () => ({ bnrExchangeRate: {} }));

const warnings: string[] = [];
mock.module('$lib/server/logger', () => ({
	logInfo: () => {},
	logError: () => {},
	logWarning: (_scope: string, message: string) => {
		warnings.push(message);
	},
	serializeError: (e: unknown) => ({ message: String(e), stack: '' })
}));

const { fetchBnrRates } = await import('../client');

/** Fragment din răspunsul real de pe curs.bnr.ro (21 aug 2026). */
const XML = `<?xml version="1.0" encoding="utf-8"?>
<DataSet xmlns="https://www.bnr.ro/xsd"><Header><PublishingDate>2026-08-21</PublishingDate></Header><Body><Subject>Reference rates</Subject><OrigCurrency>RON</OrigCurrency><Cube date="2026-08-21"><Rate currency="EUR">5.2581</Rate><Rate currency="HUF" multiplier="100">1.4467</Rate></Cube></Body></DataSet>`;

type Call = { url: string; init: Record<string, unknown> };
const calls: Call[] = [];
let respond: (call: Call) => Response | Promise<Response>;

const realFetch = globalThis.fetch;
globalThis.fetch = ((input: unknown, init: Record<string, unknown>) => {
	const call = { url: String(input), init: init ?? {} };
	calls.push(call);
	return Promise.resolve(respond(call));
}) as unknown as typeof fetch;
afterAll(() => {
	globalThis.fetch = realFetch;
});

function xmlResponse() {
	return new Response(XML, { status: 200, headers: { 'content-type': 'text/xml' } });
}

beforeEach(() => {
	calls.length = 0;
	warnings.length = 0;
	respond = () => xmlResponse();
});

describe('fetchBnrRates', () => {
	it('cere feed-ul de pe serverul dedicat curs.bnr.ro', async () => {
		await fetchBnrRates();
		expect(calls[0].url).toBe('https://curs.bnr.ro/nbrfxrates.xml');
	});

	it('nu urmează redirecturile — altfel HTML-ul de pe www ajunge la parser', async () => {
		await fetchBnrRates();
		expect(calls[0].init.redirect).toBe('manual');
	});

	it('parsează data din Cube și cotațiile, cu multiplier', async () => {
		expect(await fetchBnrRates()).toEqual([
			{ currency: 'EUR', rate: 5.2581, multiplier: 1, date: '2026-08-21' },
			{ currency: 'HUF', rate: 1.4467, multiplier: 100, date: '2026-08-21' }
		]);
	});

	// Regresia din 21 aug 2026: www.bnr.ro/nbrfxrates.xml a început să dea 302 spre
	// pagina principală, iar eroarea vizibilă era „Could not find Cube date".
	it('feed mutat: redirectul spune unde, nu „Could not find Cube date"', async () => {
		respond = () =>
			new Response(null, { status: 302, headers: { location: 'https://www.bnr.ro/' } });
		await expect(fetchBnrRates()).rejects.toThrow(/redirect 302 către https:\/\/www\.bnr\.ro\//);
	});

	it('pagină HTML cu status 200: eroare despre content-type, nu despre Cube', async () => {
		respond = () =>
			new Response('<!doctype html><html></html>', {
				status: 200,
				headers: { 'content-type': 'text/html; charset=UTF-8' }
			});
		await expect(fetchBnrRates()).rejects.toThrow(/non-XML \(content-type: text\/html/);
	});

	it('XML fără Cube: eroarea de parsare rămâne', async () => {
		respond = () =>
			new Response('<?xml version="1.0"?><DataSet></DataSet>', {
				status: 200,
				headers: { 'content-type': 'text/xml' }
			});
		await expect(fetchBnrRates()).rejects.toThrow('BNR XML: Could not find Cube date');
	});

	it('lanț TLS rupt: reîncearcă o dată fără verificare și avertizează', async () => {
		respond = (call) => {
			if (calls.length === 1) throw new Error('certificate has expired');
			expect(call.init.tls).toEqual({ rejectUnauthorized: false });
			return xmlResponse();
		};
		expect((await fetchBnrRates()).length).toBe(2);
		expect(calls.length).toBe(2);
		expect(calls[0].init.tls).toBeUndefined();
		expect(warnings[0]).toMatch(/certificate has expired/);
	});

	it('alte erori de rețea nu dezactivează verificarea TLS', async () => {
		respond = () => {
			throw new Error('connect ETIMEDOUT');
		};
		await expect(fetchBnrRates()).rejects.toThrow('connect ETIMEDOUT');
		expect(calls.length).toBe(1);
		expect(warnings.length).toBe(0);
	});
});
