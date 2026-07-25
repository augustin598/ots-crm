import { describe, it, expect } from 'bun:test';
import { createMessageWithRetry, type ClaudeLike } from '../claude-retry';

/** Client fake care răspunde din coadă, în ordine. */
function fakeClient(keyType: 'api' | 'oat', responses: Response[]): ClaudeLike & { calls: number } {
	const c = {
		keyType,
		defaultModel: 'claude-sonnet-5',
		calls: 0,
		async createMessage() {
			c.calls++;
			const r = responses.shift();
			if (!r) throw new Error('fake client: coadă goală');
			return r;
		}
	};
	return c;
}

const ok = () => new Response('{"content":[{"text":"x"}]}', { status: 200 });
const rate = (status: number, retryAfter?: string) =>
	new Response('rate limited', {
		status,
		headers: retryAfter ? { 'retry-after': retryAfter } : {}
	});

/** sleep stub care doar înregistrează duratele (fără așteptare reală). */
function sleepSpy() {
	const waits: number[] = [];
	return { waits, sleep: async (ms: number) => void waits.push(ms) };
}

describe('createMessageWithRetry', () => {
	it('succes direct — o singură cerere, fără sleep', async () => {
		const { waits, sleep } = sleepSpy();
		const client = fakeClient('oat', [ok()]);
		const res = await createMessageWithRetry(client, {}, { sleep });
		expect(res.ok).toBe(true);
		expect(client.calls).toBe(1);
		expect(waits.length).toBe(0);
	});

	it('429 apoi succes — un retry cu backoff de bază (2s + jitter ≤25%)', async () => {
		const { waits, sleep } = sleepSpy();
		const client = fakeClient('oat', [rate(429), ok()]);
		const res = await createMessageWithRetry(client, {}, { sleep });
		expect(res.ok).toBe(true);
		expect(client.calls).toBe(2);
		expect(waits.length).toBe(1);
		expect(waits[0]).toBeGreaterThanOrEqual(2000);
		expect(waits[0]).toBeLessThanOrEqual(2500);
	});

	it('respectă retry-after complet (7s), nu îl plafonează la 20s', async () => {
		const { waits, sleep } = sleepSpy();
		const client = fakeClient('oat', [rate(429, '7'), ok()]);
		await createMessageWithRetry(client, {}, { sleep });
		expect(waits[0]).toBe(7000);
	});

	it('retry-after de 45s e respectat (peste vechiul plafon de 20s)', async () => {
		const { waits, sleep } = sleepSpy();
		const client = fakeClient('oat', [rate(429, '45'), ok()]);
		await createMessageWithRetry(client, {}, { sleep });
		expect(waits[0]).toBe(45_000);
	});

	it('retry-after excesiv e plafonat la 60s', async () => {
		const { waits, sleep } = sleepSpy();
		const client = fakeClient('oat', [rate(429, '120'), ok()]);
		await createMessageWithRetry(client, {}, { sleep });
		expect(waits[0]).toBe(60_000);
	});

	it('fără retry-after → backoff exponențial crescător', async () => {
		const { waits, sleep } = sleepSpy();
		const client = fakeClient('oat', [rate(429), rate(429), rate(429), ok()]);
		await createMessageWithRetry(client, {}, { sleep });
		expect(waits.length).toBe(3);
		// 2s, 4s, 8s (+ jitter ≤25% fiecare)
		expect(waits[0]).toBeGreaterThanOrEqual(2000);
		expect(waits[1]).toBeGreaterThanOrEqual(4000);
		expect(waits[2]).toBeGreaterThanOrEqual(8000);
		expect(waits[2]).toBeLessThanOrEqual(10_000);
	});

	it('429 repetat acoperă fereastra de minut (implicit 5 retry-uri ≥ 62s cumulat)', async () => {
		const { waits, sleep } = sleepSpy();
		const client = fakeClient('oat', [
			rate(429),
			rate(429),
			rate(429),
			rate(429),
			rate(429),
			ok()
		]);
		await createMessageWithRetry(client, {}, { sleep });
		expect(client.calls).toBe(6);
		const total = waits.reduce((a, b) => a + b, 0);
		expect(total).toBeGreaterThanOrEqual(62_000);
	});

	it('529 (overloaded) e tratat ca transient', async () => {
		const { sleep } = sleepSpy();
		const client = fakeClient('oat', [rate(529), ok()]);
		const res = await createMessageWithRetry(client, {}, { sleep });
		expect(res.ok).toBe(true);
		expect(client.calls).toBe(2);
	});

	it('eroare non-transient (400) → aruncă imediat, fără retry', async () => {
		const { waits, sleep } = sleepSpy();
		const client = fakeClient('oat', [new Response('bad request', { status: 400 })]);
		await expect(createMessageWithRetry(client, {}, { sleep })).rejects.toThrow('Claude 400');
		expect(client.calls).toBe(1);
		expect(waits.length).toBe(0);
	});

	it('epuizare pe oat + fallback api disponibil → reușește pe cheia de rezervă', async () => {
		const { sleep } = sleepSpy();
		const primary = fakeClient('oat', [rate(429), rate(429), rate(429)]);
		const alt = fakeClient('api', [ok()]);
		const fallbackNotified: string[] = [];
		const res = await createMessageWithRetry(
			primary,
			{},
			{
				retries: 2,
				sleep,
				fallback: async () => alt,
				onFallback: (from, to) => void fallbackNotified.push(`${from}->${to}`)
			}
		);
		expect(res.ok).toBe(true);
		expect(primary.calls).toBe(3);
		expect(alt.calls).toBe(1);
		expect(fallbackNotified).toEqual(['oat->api']);
	});

	it('epuizare fără fallback stocat → mesaj RO cu sugestia cheii API', async () => {
		const { sleep } = sleepSpy();
		const client = fakeClient('oat', [rate(429), rate(429)]);
		await expect(
			createMessageWithRetry(client, {}, { retries: 1, sleep, fallback: async () => null })
		).rejects.toThrow(/429[\s\S]*cheie API/);
	});

	it('epuizare și pe fallback → mesaj RO menționează cheia de rezervă', async () => {
		const { sleep } = sleepSpy();
		const primary = fakeClient('oat', [rate(429), rate(429)]);
		const alt = fakeClient('api', [rate(429), rate(429), rate(429)]);
		await expect(
			createMessageWithRetry(primary, {}, { retries: 1, fallbackRetries: 2, sleep, fallback: async () => alt })
		).rejects.toThrow(/rezervă/);
		expect(alt.calls).toBe(3);
	});

	it('fallback cu eroare non-transient → eroarea aceea, cu contextul failover-ului prepandat', async () => {
		const { sleep } = sleepSpy();
		const primary = fakeClient('oat', [rate(429)]);
		const alt = fakeClient('api', [new Response('credit balance too low', { status: 400 })]);
		await expect(
			createMessageWithRetry(primary, {}, { retries: 0, sleep, fallback: async () => alt })
		).rejects.toThrow(/Abonament.*rate-limited[\s\S]*rezervă.*API[\s\S]*Claude 400/);
	});

	it('bugetul total de așteptare oprește retry-urile (nu blocăm requestul minute în șir)', async () => {
		const { waits, sleep } = sleepSpy();
		// retry-after 60s de fiecare dată; buget 90s → prima pauză (60s) încape, a doua (60s) nu.
		const client = fakeClient('oat', [rate(429, '60'), rate(429, '60')]);
		await expect(
			createMessageWithRetry(client, {}, { sleep, totalWaitBudgetMs: 90_000 })
		).rejects.toThrow(/429/);
		expect(client.calls).toBe(2);
		expect(waits).toEqual([60_000]);
	});

	it('bugetul e partajat cu clientul de rezervă', async () => {
		const { sleep } = sleepSpy();
		const primary = fakeClient('oat', [rate(429, '60'), rate(429, '60')]);
		const alt = fakeClient('api', [rate(429, '60')]);
		await expect(
			createMessageWithRetry(primary, {}, {
				sleep,
				totalWaitBudgetMs: 90_000,
				fallback: async () => alt
			})
		).rejects.toThrow(/rezervă/);
		// primar: cerere + pauză 60s + cerere (a doua pauză nu mai încape);
		// rezervă: o cerere, apoi pauza de 60s nu mai încape în bugetul rămas (30s).
		expect(primary.calls).toBe(2);
		expect(alt.calls).toBe(1);
	});

	it('factory-ul de fallback care aruncă (ex. DecryptionError) NU maschează mesajul de rate limit', async () => {
		const { sleep } = sleepSpy();
		const primary = fakeClient('oat', [rate(429)]);
		const seen: unknown[] = [];
		await expect(
			createMessageWithRetry(primary, {}, {
				retries: 0,
				sleep,
				fallback: async () => {
					throw new Error('decrypt failed');
				},
				onFallbackError: (e) => void seen.push(e)
			})
		).rejects.toThrow(/limită de rată/);
		expect(seen.length).toBe(1);
	});

	it('timeout de fetch (AbortSignal.timeout) → mesaj RO clar, nu DOMException în engleză', async () => {
		const { sleep } = sleepSpy();
		const client: ClaudeLike = {
			keyType: 'oat',
			defaultModel: 'claude-sonnet-5',
			async createMessage() {
				throw Object.assign(new Error('The operation was aborted due to timeout'), {
					name: 'TimeoutError'
				});
			}
		};
		await expect(createMessageWithRetry(client, {}, { sleep })).rejects.toThrow(
			/nu a răspuns în timpul alocat/
		);
	});
});
