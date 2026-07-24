import { describe, test, expect, mock } from 'bun:test';

// Predicate inspectabile din drizzle.
mock.module('drizzle-orm', () => ({
	eq: (col: unknown, val: unknown) => ({ kind: 'eq', col, val }),
	and: (...conds: unknown[]) => ({ kind: 'and', conds })
}));

// Schema stub: coloanele referite de syncPosts (obiecte-identitate pt comparare).
const wpPostId = { name: 'wp_post_id' };
const siteId = { name: 'site_id' };
const wordpressPost = { id: { name: 'id' }, wpPostId, siteId };
mock.module('$lib/server/db/schema', () => ({ wordpressPost, wordpressSite: {}, wordpressPendingUpdate: {} }));

// db mock: capturează predicatul de la SELECT-existing; întoarce [] (forțează INSERT).
const whereCalls: unknown[] = [];
const dbMock: { select: () => unknown; insert: () => unknown; update: () => unknown } = {
	select: () => {
		const chain: Record<string, unknown> = {
			from: () => chain,
			where: (cond: unknown) => {
				whereCalls.push(cond);
				return chain;
			},
			limit: () => chain,
			then: (r: (rows: unknown[]) => unknown) => r([]) // niciun rând existent
		};
		return chain;
	},
	insert: () => ({ values: async () => undefined }),
	update: () => ({ set: () => ({ where: async () => undefined }) })
};
mock.module('$lib/server/db', () => ({ db: dbMock }));
mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$env/static/private', () => ({}));
mock.module('$lib/server/logger', () => ({
	logInfo: () => {},
	logWarning: () => {},
	logError: () => {},
	serializeError: (e: unknown) => ({ message: String(e), stack: '' })
}));
mock.module('$lib/server/plugins/smartbill/crypto', () => ({ decrypt: () => 'secret', DecryptionError: class extends Error {} }));

// WpClient stub: loadSiteAndClient citește site-ul; forțăm listPosts să întoarcă postul 42.
mock.module('../client', () => ({
	WpClient: class {
		constructor(_u: string, _s: string) {}
		async listPosts() {
			return { items: [{ id: 42, title: 't', slug: 's', status: 'publish', contentHtml: '', excerpt: '', link: '' }], total: 1 };
		}
	},
	WpUpdateItem: {}
}));
mock.module('../errors', () => ({ WpError: { isWpError: () => false } }));
mock.module('../connector-release', () => ({ compareConnectorVersions: () => 0 }));

const { syncPosts } = await import('../sync');

describe('syncPosts existing-row lookup', () => {
	test('scoped by BOTH site_id and wp_post_id (nu doar wp_post_id)', async () => {
		// Fă loadSiteAndClient să găsească site B: primul select întoarce site-ul, apoi lookup [].
		let call = 0;
		dbMock.select = () => {
			const idx = call++;
			const chain: Record<string, unknown> = {
				from: () => chain,
				where: (cond: unknown) => {
					if (idx > 0) whereCalls.push(cond);
					return chain;
				},
				limit: () => chain,
				then: (r: (rows: unknown[]) => unknown) =>
					r(idx === 0 ? [{ id: 'siteB', tenantId: 'tn', siteUrl: 'https://b.ro', secretKey: 'x' }] : [])
			};
			return chain;
		};

		await syncPosts('siteB');

		const lookup = whereCalls[0] as { kind: string; conds?: Array<{ col: unknown }> };
		expect(lookup.kind).toBe('and');
		const cols = (lookup.conds ?? []).map((c) => c.col);
		expect(cols).toContain(siteId); // ← regresia: fără fix, e doar [wpPostId]
		expect(cols).toContain(wpPostId);
	});
});
