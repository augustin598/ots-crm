import { json, error } from '@sveltejs/kit';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { serializeError } from '$lib/server/logger';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { normalizeDomain, resolveWebsiteId } from '$lib/server/content/website-resolver';
import type { RequestHandler } from './$types';

function generateId() {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

export const POST: RequestHandler = async ({ locals }) => {
	if (!locals.user || !locals.tenant) throw error(401, 'Unauthorized');
	const role = locals.tenantUser?.role;
	if (role !== 'owner' && role !== 'admin') throw error(403, 'Forbidden: admin access required');
	const tenantId = locals.tenant.id;
	const now = new Date();

	try {
		const websites = await db
			.select({ id: table.clientWebsite.id, url: table.clientWebsite.url, clientId: table.clientWebsite.clientId })
			.from(table.clientWebsite)
			.where(eq(table.clientWebsite.tenantId, tenantId));

		const articles = await db
			.select({ id: table.contentArticle.id, brand: table.contentArticle.brand })
			.from(table.contentArticle)
			.where(eq(table.contentArticle.tenantId, tenantId));
		let assigned = 0;
		for (const a of articles) {
			const wid = resolveWebsiteId(a.brand, websites);
			if (!wid) continue;
			const w = websites.find((x) => x.id === wid)!;
			await db.update(table.contentArticle)
				.set({ websiteId: wid, clientId: w.clientId, updatedAt: now })
				.where(eq(table.contentArticle.id, a.id));
			assigned++;
		}

		const wpSites = await db
			.select({ id: table.wordpressSite.id, siteUrl: table.wordpressSite.siteUrl, clientId: table.wordpressSite.clientId })
			.from(table.wordpressSite)
			.where(eq(table.wordpressSite.tenantId, tenantId));
		let wpLinked = 0, wpClientSet = 0;
		for (const w of websites) {
			const wpMatch = wpSites.find((s) => normalizeDomain(s.siteUrl) === normalizeDomain(w.url));
			if (!wpMatch) continue;
			await db.update(table.clientWebsite).set({ wpSiteId: wpMatch.id, updatedAt: now }).where(eq(table.clientWebsite.id, w.id));
			wpLinked++;
			if (!wpMatch.clientId && w.clientId) {
				await db.update(table.wordpressSite).set({ clientId: w.clientId, updatedAt: now }).where(eq(table.wordpressSite.id, wpMatch.id));
				wpClientSet++;
			}
		}

		let profilesCreated = 0;
		let brandContext = '';
		try {
			brandContext = readFileSync(join(process.cwd(), '..', 'content', 'heylux', 'brand-context.md'), 'utf8');
		} catch { /* opțional */ }
		for (const w of websites) {
			const dom = normalizeDomain(w.url);
			const isActive = ['heylux.ro', 'luckystudio.ro', 'preziosa.ro'].includes(dom);
			if (!isActive) continue;
			const existing = await db.select({ id: table.websiteContentProfile.id })
				.from(table.websiteContentProfile)
				.where(eq(table.websiteContentProfile.websiteId, w.id)).limit(1);
			if (existing.length) continue;
			await db.insert(table.websiteContentProfile).values({
				id: generateId(),
				tenantId,
				websiteId: w.id,
				language: 'ro',
				extraNotes: dom === 'heylux.ro' ? brandContext : null,
				createdAt: now,
				updatedAt: now
			});
			profilesCreated++;
		}

		return json({ ok: true, assigned, wpLinked, wpClientSet, profilesCreated, websites: websites.length, articles: articles.length });
	} catch (e) {
		console.error('[backfill-content-websites]', serializeError(e));
		throw error(500, 'Backfill eșuat: ' + serializeError(e));
	}
};
