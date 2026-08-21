/**
 * Regression tests for `searchUsers()` / `searchUsersExtended()` shape handling.
 *
 * Why this file exists: `DAUserSearchResult` promised `{username, domain, ...}`
 * objects, but DA Evolution v1.701 actually answers `/api/search/users` with a
 * bare `["admin","topderma",...]` string array and `/api/search/users-extended`
 * with `[{user, role, ...}]` (key `user`, not `username`). Reading `.username`
 * off those gave `undefined`, which made the DA→CRM import dialog report
 * "0 new / 46" while a real DA-only account sat there unimported.
 *
 * The payloads below are verbatim captures from the production DA server.
 */

import { describe, it, expect, afterEach, mock } from 'bun:test';
import { DirectAdminClient } from '../client';

const originalFetch = globalThis.fetch;

afterEach(() => {
	globalThis.fetch = originalFetch;
});

function client(): DirectAdminClient {
	return new DirectAdminClient({
		hostname: 'da.example.com',
		port: 2222,
		username: 'admin',
		password: 'secret'
	});
}

/** Stub fetch with a JSON body and record the URLs that were requested. */
function stubJson(payload: unknown): { urls: string[] } {
	const urls: string[] = [];
	globalThis.fetch = mock(async (url: string | URL) => {
		urls.push(String(url));
		return new Response(JSON.stringify(payload), {
			status: 200,
			headers: { 'content-type': 'application/json' }
		});
	}) as unknown as typeof fetch;
	return { urls };
}

describe('searchUsers — real DA shapes', () => {
	it('parses the plain string array DA actually returns', async () => {
		stubJson(['admin', 'topderma', 'heylux']);
		const users = await client().searchUsers();

		expect(users.map((u) => u.username)).toEqual(['admin', 'topderma', 'heylux']);
		// The crash this guards: every consumer reads `.username`.
		expect(users.every((u) => typeof u.username === 'string' && u.username.length > 0)).toBe(true);
		// Domain/email are NOT in this payload — they must be empty, never undefined.
		expect(users[1]).toEqual({ username: 'topderma', domain: '', email: '', userType: '' });
	});

	it('parses the documented object array too', async () => {
		stubJson([
			{ username: 'topderma', domain: 'topderma.ro', email: 'a@b.ro', userType: 'user' }
		]);
		const users = await client().searchUsers();

		expect(users).toEqual([
			{ username: 'topderma', domain: 'topderma.ro', email: 'a@b.ro', userType: 'user' }
		]);
	});

	it('parses the `{ list: [...] }` wrapper', async () => {
		stubJson({ list: ['admin', 'topderma'] });
		const users = await client().searchUsers();
		expect(users.map((u) => u.username)).toEqual(['admin', 'topderma']);
	});

	it('parses the legacy comma-joined `{ list: "a,b,c" }` form', async () => {
		stubJson({ list: 'admin,topderma, heylux' });
		const users = await client().searchUsers();
		expect(users.map((u) => u.username)).toEqual(['admin', 'topderma', 'heylux']);
	});

	it('drops blank entries and de-duplicates case-insensitively', async () => {
		stubJson(['admin', '', '   ', 'Topderma', 'topderma']);
		const users = await client().searchUsers();
		expect(users.map((u) => u.username)).toEqual(['admin', 'Topderma']);
	});

	it('returns [] for shapes it cannot read instead of throwing', async () => {
		stubJson({ error: 'nope' });
		expect(await client().searchUsers()).toEqual([]);

		stubJson(null);
		expect(await client().searchUsers()).toEqual([]);
	});

	it('filters client-side because DA ignores ?search=', async () => {
		// DA returns the FULL list even when asked to search — verified on v1.701.
		const { urls } = stubJson(['admin', 'topderma', 'topsolution', 'heylux']);
		const users = await client().searchUsers('top');

		expect(urls[0]).toContain('/api/search/users?search=top');
		expect(users.map((u) => u.username)).toEqual(['topderma', 'topsolution']);
	});
});

describe('searchUsersExtended — real DA shape', () => {
	it('reads the `user` key and carries `role` into userType', async () => {
		stubJson([
			{ user: 'admin', role: 'admin', matchedDomains: [], matchedPointers: [] },
			{ user: 'topderma', role: 'user', matchedDomains: [], matchedPointers: [] }
		]);
		const users = await client().searchUsersExtended();

		expect(users).toEqual([
			{ username: 'admin', domain: '', email: '', userType: 'admin' },
			{ username: 'topderma', domain: '', email: '', userType: 'user' }
		]);
	});

	it('hits the extended endpoint, not the plain one', async () => {
		const { urls } = stubJson([]);
		await client().searchUsersExtended();
		expect(urls[0]).toContain('/api/search/users-extended');
	});
});
