import { describe, test, expect, mock } from 'bun:test';

// ---- capturi ----
const created: Array<Record<string, unknown>> = [];
const updates: Array<Record<string, unknown>> = [];

// db mock: articol + website (2 select-uri), apoi update-uri capturate.
function makeDb(rows: unknown[][]) {
	let i = 0;
	return {
		select: () => {
			const idx = i++;
			const chain: Record<string, unknown> = {
				from: () => chain,
				innerJoin: () => chain,
				leftJoin: () => chain,
				where: () => chain,
				limit: () => chain,
				then: (r: (v: unknown[]) => unknown) => r(rows[idx] ?? [])
			};
			return chain;
		},
		update: () => ({ set: (patch: Record<string, unknown>) => ({ where: async () => { updates.push(patch); } }) })
	};
}

mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$env/static/private', () => ({}));
mock.module('$lib/server/logger', () => ({ logInfo: () => {}, logWarning: () => {}, logError: () => {}, serializeError: (e: unknown) => ({ message: String(e), stack: '' }) }));
mock.module('$lib/server/db/schema', () => ({ contentArticle: { id: {}, tenantId: {}, websiteId: {} }, clientWebsite: { id: {}, wpSiteId: {} }, wordpressSite: { id: {} } }));
// NU mock-uim drizzle-orm (convenție repo: operatorii reali sunt puri, iar db mock ignoră .where).
mock.module('$lib/server/plugins/smartbill/crypto', () => ({ decrypt: () => 'secret', DecryptionError: class extends Error {} }));
mock.module('$lib/server/wordpress/media', () => ({ extractAndUploadInlineImages: async (_c: unknown, html: string) => ({ html, attachmentIds: [], firstUrl: null }) }));
mock.module('$lib/server/wordpress/sync', () => ({ syncPosts: async () => undefined }));
mock.module('$lib/server/wordpress/client', () => ({
	WpClient: class {
		constructor(_u: string, _s: string) {}
		async createPost(payload: Record<string, unknown>) { created.push(payload); return { id: 777, link: 'https://x.ro/p', status: payload.status, title: payload.title, slug: payload.slug, contentHtml: '', excerpt: '', featuredMediaId: null, featuredMediaUrl: null, authorWpId: 1, publishedAt: null, createdAt: '', updatedAt: '' }; }
	}
}));

let loadCounter = 0;
async function loadSUT(rows: unknown[][]) {
	mock.module('$lib/server/db', () => ({ db: makeDb(rows) }));
	const mod = await import('../publisher?' + loadCounter++); // fresh (evită cache între teste)
	return mod;
}

describe('publishArticleToWordpress', () => {
	test('publică live → status publish, persistă wp_post_id + published', async () => {
		created.length = 0; updates.length = 0;
		const article = { id: 'a1', tenantId: 'tn', websiteId: 'w1', generatedHtml: '<p>x</p>', generatedTitle: 'T', generatedExcerpt: 'E', slug: 's', targetWpSiteId: null, rewriteStatus: 'ready' };
		const site = { id: 'wp1', tenantId: 'tn', siteUrl: 'https://x.ro', secretKey: 'enc' };
		const { publishArticleToWordpress } = await loadSUT([[article], [{ wpSiteId: 'wp1' }], [site]]);
		const res = await publishArticleToWordpress('tn', 'a1', { status: 'publish' });
		expect(res.wpPostId).toBe(777);
		expect(created[0].status).toBe('publish');
		const patch = updates.at(-1)!;
		expect(patch.wpPostId).toBe(777);
		expect(patch.publishStatus).toBe('published');
	});

	test('fără wpSiteId → aruncă (cere legare WP)', async () => {
		const article = { id: 'a1', tenantId: 'tn', websiteId: 'w1', generatedHtml: '<p>x</p>', targetWpSiteId: null };
		const { publishArticleToWordpress } = await loadSUT([[article], [{ wpSiteId: null }]]);
		await expect(publishArticleToWordpress('tn', 'a1', { status: 'publish' })).rejects.toThrow(/WordPress/i);
	});

	test('fără generatedHtml → aruncă (generează întâi)', async () => {
		const article = { id: 'a1', tenantId: 'tn', websiteId: 'w1', generatedHtml: null, targetWpSiteId: 'wp1' };
		const site = { id: 'wp1', tenantId: 'tn', siteUrl: 'https://x.ro', secretKey: 'enc' };
		const { publishArticleToWordpress } = await loadSUT([[article], [{ wpSiteId: 'wp1' }], [site]]);
		await expect(publishArticleToWordpress('tn', 'a1', { status: 'publish' })).rejects.toThrow(/generat/i);
	});
});
