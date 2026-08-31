// Fără PSI_API_KEY: un 429 vine de la proiectul anonim partajat Google (cotă
// epuizată permanent) — eroarea trebuie să spună explicit că lipsește cheia
// și să NU se reîncerce (cota e per zi, retry-ul e zgomot inutil).
import { describe, test, expect, mock } from 'bun:test';

mock.module('$env/dynamic/private', () => ({ env: {} })); // fără PSI_API_KEY
mock.module('$env/static/private', () => ({}));

const { fetchPagespeed, buildPsiUrl } = await import('../client');

describe('fetchPagespeed fără cheie API', () => {
	test('URL-ul nu conține parametrul key', () => {
		expect(buildPsiUrl('https://example.ro/', 'mobile', null)).not.toContain('key=');
	});

	test('429 → mesaj explicit despre PSI_API_KEY, fără retry', async () => {
		let calls = 0;
		const fakeFetch = async () => {
			calls++;
			return new Response(JSON.stringify({ error: { message: 'Quota exceeded' } }), { status: 429 });
		};
		let caught: unknown;
		try {
			await fetchPagespeed('https://example.ro/', 'mobile', { fetch: fakeFetch, sleep: async () => {} });
		} catch (error) {
			caught = error;
		}
		expect(calls).toBe(1); // fără retry pe cota anonimă
		expect(String((caught as Error).message)).toContain('PSI_API_KEY');
	});
});
