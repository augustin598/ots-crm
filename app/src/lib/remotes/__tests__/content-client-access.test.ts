import { describe, test, expect, mock, beforeEach } from 'bun:test';

mock.module('$env/dynamic/private', () => ({ env: {} }));
mock.module('$env/static/private', () => ({}));
mock.module('$env/dynamic/public', () => ({ env: {} }));

// ─── Request context ──────────────────────────────────────────────────────────

let currentEvent: any = null;

mock.module('$app/server', () => ({
	query: (schemaOrFn: any, fn?: Function) => fn ?? schemaOrFn,
	command: (schemaOrFn: any, fn?: Function) => fn ?? schemaOrFn,
	getRequestEvent: () => currentEvent
}));

// ─── Fake DB ──────────────────────────────────────────────────────────────────

const queryQueue: Array<unknown[]> = [];
const insertedValues: unknown[] = [];
const updatePatches: unknown[] = [];

function makeChain(rows: unknown[]): any {
	const p = Promise.resolve(rows);
	return Object.assign(p, {
		from: () => makeChain(rows),
		innerJoin: () => makeChain(rows),
		leftJoin: () => makeChain(rows),
		where: () => makeChain(rows),
		orderBy: () => makeChain(rows),
		limit: () => makeChain(rows),
		offset: () => makeChain(rows),
		groupBy: () => makeChain(rows),
		returning: () => makeChain(rows),
		set: () => makeChain(rows)
	});
}

// ─── Schema mock ──────────────────────────────────────────────────────────────
// Eager-load the REAL schema before mocking — vezi comentariul CRITICAL din
// tasks.remote.test.ts (registry-ul global de mock-uri Bun partajat între fișiere).
await import('$lib/server/db/schema');

const col = (n: string) => n;

mock.module('$lib/server/db/schema', () => ({
	contentArticle: {
		id: col('id'), tenantId: col('tenantId'), websiteId: col('websiteId'),
		clientId: col('clientId'), brand: col('brand'), origin: col('origin'),
		sourceUrl: col('sourceUrl'), sourceDomain: col('sourceDomain'), brief: col('brief'),
		title: col('title'), wordCount: col('wordCount'), bodyText: col('bodyText'),
		bodyHtml: col('bodyHtml'), publishedAt: col('publishedAt'),
		featuredImageUrl: col('featuredImageUrl'), extractStatus: col('extractStatus'),
		extractError: col('extractError'), rewriteStatus: col('rewriteStatus'),
		generatedTitle: col('generatedTitle'), generatedExcerpt: col('generatedExcerpt'),
		generatedHtml: col('generatedHtml'), generatedAt: col('generatedAt'),
		articleDirection: col('articleDirection'), seoTitle: col('seoTitle'),
		metaDescription: col('metaDescription'), focusKeyword: col('focusKeyword'),
		slug: col('slug'), targetWpSiteId: col('targetWpSiteId'), wpPostId: col('wpPostId'),
		wpCategories: col('wpCategories'), scheduledAt: col('scheduledAt'),
		publishStatus: col('publishStatus'), createdAt: col('createdAt'), updatedAt: col('updatedAt')
	},
	contentImportJob: {
		id: col('id'), tenantId: col('tenantId'), userId: col('userId'),
		status: col('status'), createdAt: col('createdAt'), updatedAt: col('updatedAt')
	},
	clientWebsite: {
		id: col('id'), tenantId: col('tenantId'), clientId: col('clientId'),
		name: col('name'), url: col('url'), isDefault: col('isDefault'),
		wpSiteId: col('wpSiteId'), createdAt: col('createdAt'), updatedAt: col('updatedAt')
	},
	websiteContentProfile: {
		id: col('id'), tenantId: col('tenantId'), websiteId: col('websiteId'),
		tone: col('tone'), audience: col('audience'), language: col('language'),
		keywords: col('keywords'), topics: col('topics'), doList: col('doList'),
		dontList: col('dontList'), guardrails: col('guardrails'), sampleUrls: col('sampleUrls'),
		extraNotes: col('extraNotes'), publishMode: col('publishMode'),
		cadencePerWeek: col('cadencePerWeek'), daysOfWeek: col('daysOfWeek'),
		publishTime: col('publishTime'), defaultWpStatus: col('defaultWpStatus'),
		autoApprove: col('autoApprove'), allowClientAi: col('allowClientAi'),
		createdAt: col('createdAt'), updatedAt: col('updatedAt')
	},
	client: { id: col('id'), tenantId: col('tenantId'), name: col('name') },
	wordpressSite: {
		id: col('id'), tenantId: col('tenantId'), siteUrl: col('siteUrl'), status: col('status')
	}
}));

mock.module('$lib/server/db', () => ({
	db: {
		select: () => makeChain(queryQueue.length > 0 ? (queryQueue.shift() as unknown[]) : []),
		selectDistinct: () => makeChain(queryQueue.length > 0 ? (queryQueue.shift() as unknown[]) : []),
		insert: () => ({
			values: (v: unknown) => {
				insertedValues.push(v);
				return Promise.resolve();
			}
		}),
		update: () => ({
			set: (p: unknown) => {
				updatePatches.push(p);
				return {
					where: () => Object.assign(Promise.resolve(), { returning: () => Promise.resolve([]) })
				};
			}
		})
	}
}));

// ─── Side-effect mocks ────────────────────────────────────────────────────────

// requireStaff: refuză client users cu 403, ca assertStaff real.
// Exportăm TOATE simbolurile reale (getActor, assertCanFromEvent) — mock.module
// înlocuiește namespace-ul în registry-ul global Bun, partajat între fișierele de
// test din același proces; dacă lipsesc, importurile statice ale vecinilor pică.
const requireStaffMock = async (event: any) => {
	if (!event?.locals?.user) {
		const e: any = new Error('Unauthorized');
		e.status = 401;
		throw e;
	}
	if (event.locals.isClientUser) {
		const e: any = new Error('Forbidden');
		e.status = 403;
		throw e;
	}
	return {};
};
mock.module('$lib/server/get-actor', () => ({
	requireStaff: requireStaffMock,
	getActor: async () => ({}),
	assertCanFromEvent: async () => ({})
}));

mock.module('$lib/server/content/heylux-sources', () => ({ HEYLUX_SOURCE_URLS: [] }));
mock.module('$lib/server/content/content-pipeline', () => ({
	launchContentExtractionJob: () => {}
}));
mock.module('$lib/server/content/article-generator', () => ({
	generateArticle: async () => ({
		title: 'T', excerpt: 'E', html: '<p>x</p>',
		seoTitle: 'ST', metaDescription: 'MD', focusKeyword: 'FK', slug: 'slug'
	}),
	generateSeoMeta: async () => ({
		seoTitle: 'ST', metaDescription: 'MD', focusKeyword: 'FK', slug: 'slug'
	})
}));
mock.module('$lib/server/content/publisher', () => ({
	publishArticleToWordpress: async () => ({
		wpPostId: 7, link: 'https://example.com/x', publishStatus: 'published'
	}),
	refreshWebsiteWpCategories: async () => ({ ok: true })
}));

const {
	getContentWebsites,
	getWebsiteArticles,
	getContentArticle,
	updateContentArticle,
	generateArticleFromBrief,
	modifyArticle,
	humanizeArticle,
	generateArticleSeo,
	getWebsiteCalendar,
	publishArticle,
	scheduleArticle,
	unscheduleArticle,
	importHeyluxSources,
	getTenantWordpressSites,
	setWebsiteWpSite,
	refreshArticleWpCategories
} = await import('../content-articles.remote');

const {
	getWebsiteContentProfile,
	updateWebsiteContentProfile,
	updateWebsitePublishPolicy
} = await import('../website-content-profile.remote');

const { getClientAiAccess, setClientContentAiAccess } = await import('../client-ai-access.remote');

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const staffEvent = {
	locals: { user: { id: 'staff1' }, tenant: { id: 't1' }, isClientUser: false }
};
const clientEvent = {
	locals: {
		user: { id: 'cu1' },
		tenant: { id: 't1' },
		isClientUser: true,
		client: { id: 'clientA' }
	}
};

const ACCESS_OK = { allow: true };
const ACCESS_OFF = { allow: false };

async function expectStatus(p: Promise<unknown>, status: number) {
	try {
		await p;
		throw new Error(`Expected error ${status}, dar apelul a reușit`);
	} catch (e: any) {
		expect(e.status).toBe(status);
	}
}

beforeEach(() => {
	queryQueue.length = 0;
	insertedValues.length = 0;
	updatePatches.length = 0;
	currentEvent = null;
});

// ─── getContentWebsites ───────────────────────────────────────────────────────

describe('getContentWebsites', () => {
	test('client user: nu trece prin requireStaff, primește lista (filtrată server-side)', async () => {
		currentEvent = clientEvent;
		queryQueue.push([{ id: 'w1', clientId: 'clientA', allowClientAi: true }]);
		const rows = (await (getContentWebsites as any)()) as any[];
		expect(rows.length).toBe(1);
		expect(rows[0].id).toBe('w1');
	});

	test('staff: funcționează ca înainte', async () => {
		currentEvent = staffEvent;
		queryQueue.push([{ id: 'w1' }, { id: 'w2' }]);
		const rows = (await (getContentWebsites as any)()) as any[];
		expect(rows.length).toBe(2);
	});

	test('fără user: 401', async () => {
		currentEvent = { locals: {} };
		await expectStatus((getContentWebsites as any)(), 401);
	});
});

// ─── getWebsiteArticles ───────────────────────────────────────────────────────

describe('getWebsiteArticles', () => {
	test('client cu switch ON pe website-ul lui: primește articolele', async () => {
		currentEvent = clientEvent;
		queryQueue.push([ACCESS_OK]); // access check
		queryQueue.push([{ id: 'a1' }, { id: 'a2' }]); // articles
		const rows = (await (getWebsiteArticles as any)({ websiteId: 'w1' })) as any[];
		expect(rows.length).toBe(2);
	});

	test('client pe website care nu e al lui: 403', async () => {
		currentEvent = clientEvent;
		queryQueue.push([]); // access check: no row
		await expectStatus((getWebsiteArticles as any)({ websiteId: 'w-other' }), 403);
	});

	test('client cu switch OFF: 403', async () => {
		currentEvent = clientEvent;
		queryQueue.push([ACCESS_OFF]);
		await expectStatus((getWebsiteArticles as any)({ websiteId: 'w1' }), 403);
	});

	test('staff: nu face access-check suplimentar', async () => {
		currentEvent = staffEvent;
		queryQueue.push([{ id: 'a1' }]);
		const rows = (await (getWebsiteArticles as any)({ websiteId: 'w1' })) as any[];
		expect(rows.length).toBe(1);
	});
});

// ─── getContentArticle ────────────────────────────────────────────────────────

describe('getContentArticle', () => {
	test('client: articol de pe website-ul lui cu switch ON', async () => {
		currentEvent = clientEvent;
		queryQueue.push([{ id: 'a1', websiteId: 'w1' }]);
		queryQueue.push([ACCESS_OK]);
		const row = (await (getContentArticle as any)('a1')) as any;
		expect(row.id).toBe('a1');
	});

	test('client: articol de pe website interzis: 403', async () => {
		currentEvent = clientEvent;
		queryQueue.push([{ id: 'a1', websiteId: 'w-other' }]);
		queryQueue.push([]);
		await expectStatus((getContentArticle as any)('a1'), 403);
	});

	test('client: articol fără websiteId: 403', async () => {
		currentEvent = clientEvent;
		queryQueue.push([{ id: 'a1', websiteId: null }]);
		await expectStatus((getContentArticle as any)('a1'), 403);
	});

	test('client: articol inexistent: null (fără access-check)', async () => {
		currentEvent = clientEvent;
		queryQueue.push([]);
		const row = await (getContentArticle as any)('nope');
		expect(row).toBeNull();
	});
});

// ─── Mutații pe articol ───────────────────────────────────────────────────────

describe('updateContentArticle', () => {
	test('client permis: salvează', async () => {
		currentEvent = clientEvent;
		queryQueue.push([{ websiteId: 'w1' }]); // article lookup
		queryQueue.push([ACCESS_OK]);
		const res = (await (updateContentArticle as any)({ id: 'a1', generatedTitle: 'X' })) as any;
		expect(res.ok).toBe(true);
		expect(updatePatches.length).toBe(1);
	});

	test('client interzis: 403 și NU scrie nimic', async () => {
		currentEvent = clientEvent;
		queryQueue.push([{ websiteId: 'w1' }]);
		queryQueue.push([]);
		await expectStatus((updateContentArticle as any)({ id: 'a1', generatedTitle: 'X' }), 403);
		expect(updatePatches.length).toBe(0);
	});
});

describe('generateArticleFromBrief', () => {
	test('client permis: creează articolul', async () => {
		currentEvent = clientEvent;
		queryQueue.push([ACCESS_OK]); // access check
		queryQueue.push([{ id: 'w1', clientId: 'clientA' }]); // website lookup
		const res = (await (generateArticleFromBrief as any)({ websiteId: 'w1', brief: 'subiect' })) as any;
		expect(res.ok).toBe(true);
		expect(insertedValues.length).toBe(1);
	});

	test('client interzis: 403, nimic inserat', async () => {
		currentEvent = clientEvent;
		queryQueue.push([]);
		await expectStatus(
			(generateArticleFromBrief as any)({ websiteId: 'w-other', brief: 'subiect' }),
			403
		);
		expect(insertedValues.length).toBe(0);
	});
});

describe('acțiuni AI pe articol (modify/humanize/seo)', () => {
	test('modifyArticle: client permis', async () => {
		currentEvent = clientEvent;
		queryQueue.push([{ id: 'a1', websiteId: 'w1', generatedHtml: '<p>t</p>' }]);
		queryQueue.push([ACCESS_OK]);
		queryQueue.push([]); // loadContentProfile
		const res = (await (modifyArticle as any)({ articleId: 'a1', instruction: 'mai scurt' })) as any;
		expect(res.ok).toBe(true);
	});

	test('modifyArticle: client interzis: 403', async () => {
		currentEvent = clientEvent;
		queryQueue.push([{ id: 'a1', websiteId: 'w-other', generatedHtml: '<p>t</p>' }]);
		queryQueue.push([]);
		await expectStatus((modifyArticle as any)({ articleId: 'a1', instruction: 'x' }), 403);
	});

	test('humanizeArticle: client interzis: 403', async () => {
		currentEvent = clientEvent;
		queryQueue.push([{ id: 'a1', websiteId: 'w-other', generatedHtml: '<p>t</p>' }]);
		queryQueue.push([]);
		await expectStatus((humanizeArticle as any)('a1'), 403);
	});

	test('generateArticleSeo: client permis', async () => {
		currentEvent = clientEvent;
		queryQueue.push([{ id: 'a1', websiteId: 'w1', generatedHtml: '<p>t</p>' }]);
		queryQueue.push([ACCESS_OK]);
		queryQueue.push([]); // loadContentProfile
		const res = (await (generateArticleSeo as any)('a1')) as any;
		expect(res.ok).toBe(true);
	});
});

// ─── Calendar + publicare ─────────────────────────────────────────────────────

describe('getWebsiteCalendar', () => {
	test('client permis: primește calendarul', async () => {
		currentEvent = clientEvent;
		queryQueue.push([ACCESS_OK]);
		queryQueue.push([{ id: 'a1' }]);
		const rows = (await (getWebsiteCalendar as any)({ websiteId: 'w1', year: 2026, month: 6 })) as any[];
		expect(rows.length).toBe(1);
	});

	test('client interzis: 403', async () => {
		currentEvent = clientEvent;
		queryQueue.push([]);
		await expectStatus((getWebsiteCalendar as any)({ websiteId: 'w-x', year: 2026, month: 6 }), 403);
	});
});

describe('publishArticle / scheduleArticle / unscheduleArticle', () => {
	test('publishArticle: client permis', async () => {
		currentEvent = clientEvent;
		queryQueue.push([{ websiteId: 'w1' }]); // article lookup
		queryQueue.push([ACCESS_OK]);
		const res = (await (publishArticle as any)({ articleId: 'a1', mode: 'draft' })) as any;
		expect(res.ok).toBe(true);
		expect(res.wpPostId).toBe(7);
	});

	test('publishArticle: client interzis: 403', async () => {
		currentEvent = clientEvent;
		queryQueue.push([{ websiteId: 'w-other' }]);
		queryQueue.push([]);
		await expectStatus((publishArticle as any)({ articleId: 'a1', mode: 'draft' }), 403);
	});

	test('scheduleArticle: client permis', async () => {
		currentEvent = clientEvent;
		queryQueue.push([{ websiteId: 'w1' }]); // article lookup (guard)
		queryQueue.push([ACCESS_OK]);
		queryQueue.push([{ rewriteStatus: 'ready', publishStatus: 'none' }]); // status check
		const res = (await (scheduleArticle as any)({
			articleId: 'a1',
			scheduledAt: '2026-08-01T10:00:00.000Z'
		})) as any;
		expect(res.ok).toBe(true);
	});

	test('unscheduleArticle: client interzis: 403', async () => {
		currentEvent = clientEvent;
		queryQueue.push([{ websiteId: 'w-other' }]);
		queryQueue.push([]);
		await expectStatus((unscheduleArticle as any)('a1'), 403);
		expect(updatePatches.length).toBe(0);
	});
});

// ─── Funcții care RĂMÂN staff-only ────────────────────────────────────────────

describe('staff-only rămân blocate pentru client users', () => {
	const cases: Array<[string, () => Promise<unknown>]> = [
		['importHeyluxSources', () => (importHeyluxSources as any)()]
	];
	for (const [name, call] of cases) {
		test(`${name}: client user → 403`, async () => {
			currentEvent = clientEvent;
			await expectStatus(call(), 403);
		});
	}
});

// ─── Acces COMPLET al clientului: profil brand, politică, WP, categorii ───────
// Când switch-ul e ON, clientul are acces la tot modulul (gate per-website).

describe('getWebsiteContentProfile (client acces complet)', () => {
	test('client permis: primește profilul', async () => {
		currentEvent = clientEvent;
		queryQueue.push([ACCESS_OK]);
		queryQueue.push([{ id: 'p1', tone: 'cald' }]);
		const row = (await (getWebsiteContentProfile as any)('w1')) as any;
		expect(row.id).toBe('p1');
	});
	test('client interzis: 403', async () => {
		currentEvent = clientEvent;
		queryQueue.push([]);
		await expectStatus((getWebsiteContentProfile as any)('w-other'), 403);
	});
});

describe('updateWebsiteContentProfile (client acces complet)', () => {
	test('client permis: salvează (update existent)', async () => {
		currentEvent = clientEvent;
		queryQueue.push([ACCESS_OK]); // access
		queryQueue.push([{ id: 'p1' }]); // existing profile
		const res = (await (updateWebsiteContentProfile as any)({ websiteId: 'w1', tone: 'nou' })) as any;
		expect(res.ok).toBe(true);
		expect(updatePatches.length).toBe(1);
	});
	test('client interzis: 403, fără scriere', async () => {
		currentEvent = clientEvent;
		queryQueue.push([]);
		await expectStatus((updateWebsiteContentProfile as any)({ websiteId: 'w-x', tone: 'x' }), 403);
		expect(updatePatches.length).toBe(0);
		expect(insertedValues.length).toBe(0);
	});
});

describe('updateWebsitePublishPolicy (client acces complet)', () => {
	const policy = {
		websiteId: 'w1',
		publishMode: 'manual' as const,
		cadencePerWeek: 3,
		defaultWpStatus: 'draft' as const,
		autoApprove: false
	};
	test('client permis: salvează', async () => {
		currentEvent = clientEvent;
		queryQueue.push([ACCESS_OK]);
		queryQueue.push([{ id: 'p1' }]);
		const res = (await (updateWebsitePublishPolicy as any)(policy)) as any;
		expect(res.ok).toBe(true);
	});
	test('client interzis: 403', async () => {
		currentEvent = clientEvent;
		queryQueue.push([]);
		await expectStatus((updateWebsitePublishPolicy as any)({ ...policy, websiteId: 'w-x' }), 403);
	});
});

describe('getTenantWordpressSites (client scopat)', () => {
	test('client: primește doar site-urile WP legate la site-urile lui', async () => {
		currentEvent = clientEvent;
		queryQueue.push([{ id: 'wp1', siteUrl: 'https://a.ro' }]); // selectDistinct scopat
		const rows = (await (getTenantWordpressSites as any)()) as any[];
		expect(rows.length).toBe(1);
		expect(rows[0].id).toBe('wp1');
	});
	test('staff: toate site-urile WP ale tenantului', async () => {
		currentEvent = staffEvent;
		queryQueue.push([{ id: 'wp1' }, { id: 'wp2' }]);
		const rows = (await (getTenantWordpressSites as any)()) as any[];
		expect(rows.length).toBe(2);
	});
});

describe('setWebsiteWpSite (client acces complet, anti-leak)', () => {
	test('client: leagă un WP deja folosit de un site al lui', async () => {
		currentEvent = clientEvent;
		queryQueue.push([ACCESS_OK]); // assertWebsiteClientAccess
		queryQueue.push([{ id: 'wp1' }]); // valid tenant WP
		queryQueue.push([{ id: 'cw1' }]); // propriu clientului
		const res = (await (setWebsiteWpSite as any)({ websiteId: 'w1', wpSiteId: 'wp1' })) as any;
		expect(res.ok).toBe(true);
		expect(updatePatches.length).toBe(1);
	});
	test('client: NU poate lega un WP al altui client → 403', async () => {
		currentEvent = clientEvent;
		queryQueue.push([ACCESS_OK]); // access la website OK
		queryQueue.push([{ id: 'wp9' }]); // WP există în tenant
		queryQueue.push([]); // dar NU e al clientului
		await expectStatus((setWebsiteWpSite as any)({ websiteId: 'w1', wpSiteId: 'wp9' }), 403);
		expect(updatePatches.length).toBe(0);
	});
	test('client: unlink (null) permis pe site-ul lui', async () => {
		currentEvent = clientEvent;
		queryQueue.push([ACCESS_OK]);
		const res = (await (setWebsiteWpSite as any)({ websiteId: 'w1', wpSiteId: null })) as any;
		expect(res.ok).toBe(true);
	});
	test('client: website care nu e al lui → 403', async () => {
		currentEvent = clientEvent;
		queryQueue.push([]); // access-check gol
		await expectStatus((setWebsiteWpSite as any)({ websiteId: 'w-x', wpSiteId: null }), 403);
	});
});

describe('refreshArticleWpCategories (client acces complet)', () => {
	test('client permis', async () => {
		currentEvent = clientEvent;
		queryQueue.push([ACCESS_OK]);
		const res = (await (refreshArticleWpCategories as any)('w1')) as any;
		expect(res.ok).toBe(true);
	});
	test('client interzis: 403', async () => {
		currentEvent = clientEvent;
		queryQueue.push([]);
		await expectStatus((refreshArticleWpCategories as any)('w-x'), 403);
	});
});

// ─── getClientAiAccess (starea panoului „Acces AI") ───────────────────────────

describe('getClientAiAccess', () => {
	test('client user: 403', async () => {
		currentEvent = clientEvent;
		await expectStatus((getClientAiAccess as any)('clientA'), 403);
	});

	test('staff, toate site-urile enabled → copywriting ON', async () => {
		currentEvent = staffEvent;
		queryQueue.push([{ id: 'w1' }, { id: 'w2' }]); // clientWebsiteIds
		queryQueue.push([{ websiteId: 'w1' }, { websiteId: 'w2' }]); // enabled profiles
		const res = (await (getClientAiAccess as any)('clientA')) as any;
		expect(res.websiteCount).toBe(2);
		expect(res.enabledCount).toBe(2);
		expect(res.copywriting).toBe(true);
	});

	// Semantica ANY (aliniată cu gate-ul portalului): ≥1 site enabled → ON, ca switch-ul
	// să NU se stingă fals când clientul capătă un site nou încă neactivat.
	test('staff, ≥1 site enabled → copywriting ON (ANY)', async () => {
		currentEvent = staffEvent;
		queryQueue.push([{ id: 'w1' }, { id: 'w2' }]);
		queryQueue.push([{ websiteId: 'w1' }]); // doar w1 enabled
		const res = (await (getClientAiAccess as any)('clientA')) as any;
		expect(res.enabledCount).toBe(1);
		expect(res.copywriting).toBe(true);
	});

	test('staff, niciun site enabled → copywriting OFF', async () => {
		currentEvent = staffEvent;
		queryQueue.push([{ id: 'w1' }, { id: 'w2' }]);
		queryQueue.push([]); // niciun profil enabled
		const res = (await (getClientAiAccess as any)('clientA')) as any;
		expect(res.copywriting).toBe(false);
	});

	test('staff, client fără website-uri → copywriting OFF, fără a doua interogare', async () => {
		currentEvent = staffEvent;
		queryQueue.push([]); // no websites
		const res = (await (getClientAiAccess as any)('clientA')) as any;
		expect(res.websiteCount).toBe(0);
		expect(res.copywriting).toBe(false);
	});
});

// ─── setClientContentAiAccess (switch-ul „Copywriting / conținut") ────────────

describe('setClientContentAiAccess', () => {
	test('client user: 403', async () => {
		currentEvent = clientEvent;
		await expectStatus((setClientContentAiAccess as any)({ clientId: 'clientA', allow: true }), 403);
	});

	test('staff, allow=true: update pe cele cu profil + insert pe cele fără', async () => {
		currentEvent = staffEvent;
		queryQueue.push([{ id: 'w1' }, { id: 'w2' }]); // clientWebsiteIds
		queryQueue.push([{ websiteId: 'w1' }]); // existing profiles (doar w1)
		const res = (await (setClientContentAiAccess as any)({ clientId: 'clientA', allow: true })) as any;
		expect(res.ok).toBe(true);
		expect(res.affected).toBe(2);
		expect(updatePatches.length).toBe(1);
		expect((updatePatches[0] as any).allowClientAi).toBe(true);
		expect(insertedValues.length).toBe(1);
		const inserted = insertedValues[0] as any[];
		expect(inserted.length).toBe(1);
		expect(inserted[0].websiteId).toBe('w2');
		expect(inserted[0].allowClientAi).toBe(true);
		expect(inserted[0].tenantId).toBe('t1');
	});

	test('staff, allow=false: update pe toate, fără insert', async () => {
		currentEvent = staffEvent;
		queryQueue.push([{ id: 'w1' }, { id: 'w2' }]);
		queryQueue.push([{ websiteId: 'w1' }, { websiteId: 'w2' }]);
		const res = (await (setClientContentAiAccess as any)({ clientId: 'clientA', allow: false })) as any;
		expect(res.affected).toBe(2);
		expect(updatePatches.length).toBe(1);
		expect((updatePatches[0] as any).allowClientAi).toBe(false);
		expect(insertedValues.length).toBe(0);
	});

	test('staff, client fără website-uri: no-op, affected 0', async () => {
		currentEvent = staffEvent;
		queryQueue.push([]); // no websites
		const res = (await (setClientContentAiAccess as any)({ clientId: 'clientA', allow: true })) as any;
		expect(res.affected).toBe(0);
		expect(updatePatches.length).toBe(0);
		expect(insertedValues.length).toBe(0);
	});
});
