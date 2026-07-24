import { describe, test, expect, mock } from 'bun:test';

const q: unknown[][] = [];

mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$env/static/private', () => ({}));
mock.module('$lib/server/logger', () => ({ logInfo: () => {}, logWarning: () => {}, logError: () => {}, serializeError: (e: unknown) => ({ message: String(e), stack: '' }) }));
mock.module('$lib/server/db/schema', () => ({ websiteContentProfile: { publishMode: {}, tenantId: {}, websiteId: {} }, contentArticle: { id: {}, websiteId: {}, tenantId: {}, rewriteStatus: {}, scheduledAt: {}, publishStatus: {} } }));
// NU mock-uim drizzle-orm (convenție repo: operatorii reali sunt puri, iar db mock ignoră .where).
mock.module('$lib/server/db', () => ({
	db: {
		select: () => { const c: Record<string, unknown> = { from: () => c, where: () => c, limit: () => c, orderBy: () => c, then: (r: (v: unknown[]) => unknown) => r(q.shift() ?? []) }; return c; },
		update: () => ({ set: () => ({ where: async () => undefined }) })
	}
}));
mock.module('$lib/server/content/article-generator', () => ({ generateArticle: async () => ({ title: 'T', html: '<p>x</p>', excerpt: 'E', model: 'm', focusKeyword: '', seoTitle: '', metaDescription: '', slug: 's' }) }));

const { processContentAutoGenerate } = await import('../content-auto-generate');

describe('processContentAutoGenerate', () => {
	test('dryRun raportează planul fără să scrie', async () => {
		// 1) websites auto; 2) programate existente (0); 3) surse nerescrise
		q.push([{ websiteId: 'w1', tenantId: 'tn', cadencePerWeek: 3, daysOfWeek: null, publishTime: '10:00', autoApprove: false }]);
		q.push([]); // programate în viitor
		q.push([{ id: 's1' }, { id: 's2' }, { id: 's3' }]); // surse candidate
		const res = await processContentAutoGenerate({ dryRun: true });
		expect(res.websites).toBe(1);
		expect(res.planned).toBeGreaterThan(0);
		expect(res.generated).toBe(0); // dryRun nu scrie
	});
});
