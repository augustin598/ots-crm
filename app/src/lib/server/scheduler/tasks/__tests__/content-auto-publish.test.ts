import { describe, test, expect, mock } from 'bun:test';

const published: string[] = [];
const queue: unknown[][] = [];
let claimRows = 1; // rowsAffected pe UPDATE-ul de claim (1 = prins, 0 = deja luat)

mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$env/static/private', () => ({}));
mock.module('$lib/server/logger', () => ({ logInfo: () => {}, logWarning: () => {}, logError: () => {}, serializeError: (e: unknown) => ({ message: String(e), stack: '' }) }));
mock.module('$lib/server/db/schema', () => ({ contentArticle: { id: {}, tenantId: {}, publishStatus: {}, rewriteStatus: {}, scheduledAt: {}, websiteId: {} }, websiteContentProfile: { websiteId: {}, defaultWpStatus: {} } }));
// NU mock-uim drizzle-orm (convenție repo: operatorii reali sunt puri, iar db mock ignoră .where).
mock.module('$lib/server/db', () => ({
	db: {
		select: () => { const c: Record<string, unknown> = { from: () => c, leftJoin: () => c, where: () => c, limit: () => c, then: (r: (v: unknown[]) => unknown) => r(queue.shift() ?? []) }; return c; },
		update: () => ({ set: () => ({ where: async () => ({ rowsAffected: claimRows }) }) })
	}
}));
mock.module('$lib/server/content/publisher', () => ({
	publishArticleToWordpress: async (_t: string, id: string) => { published.push(id); return { ok: true, wpPostId: 1, link: null, publishStatus: 'published' }; }
}));

const { processContentAutoPublish } = await import('../content-auto-publish');

describe('processContentAutoPublish', () => {
	test('publică scadentele prinse de claim; dryRun nu publică', async () => {
		published.length = 0; claimRows = 1;
		queue.push([{ id: 'a1', tenantId: 'tn' }, { id: 'a2', tenantId: 'tn' }]);
		const dry = await processContentAutoPublish({ dryRun: true });
		expect(dry.due).toBe(2);
		expect(published.length).toBe(0); // dryRun nu revendică, nu publică

		queue.push([{ id: 'a1', tenantId: 'tn' }, { id: 'a2', tenantId: 'tn' }]);
		const live = await processContentAutoPublish({ dryRun: false });
		expect(live.published).toBe(2);
		expect(published).toEqual(['a1', 'a2']);
	});

	test('claim eșuat (rowsAffected=0) → sare articolul, nu publică dublu', async () => {
		published.length = 0; claimRows = 0; // altcineva l-a luat deja
		queue.push([{ id: 'a1', tenantId: 'tn' }]);
		const res = await processContentAutoPublish({ dryRun: false });
		expect(res.published).toBe(0);
		expect(res.skipped).toBe(1);
		expect(published.length).toBe(0);
	});
});
