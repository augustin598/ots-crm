import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, count, sum, sql } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';

function generateClientWebsiteId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

/** Returnează toate website-urile unui client */
export const getClientWebsites = query(
	v.pipe(v.string(), v.minLength(1)),
	async (clientId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		const websites = await db
			.select()
			.from(table.clientWebsite)
			.where(
				and(
					eq(table.clientWebsite.clientId, clientId),
					eq(table.clientWebsite.tenantId, event.locals.tenant.id)
				)
			);

		return websites;
	}
);

/** Returnează website-urile unui client cu statistici SEO per website */
export const getClientWebsitesSeoStats = query(
	v.pipe(v.string(), v.minLength(1)),
	async (clientId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		const tenantId = event.locals.tenant.id;

		const websites = await db
			.select()
			.from(table.clientWebsite)
			.where(
				and(
					eq(table.clientWebsite.clientId, clientId),
					eq(table.clientWebsite.tenantId, tenantId)
				)
			);

		const stats = await Promise.all(
			websites.map(async (website) => {
				const links = await db
					.select({
						id: table.seoLink.id,
						status: table.seoLink.status,
						linkAttribute: table.seoLink.linkAttribute,
						lastCheckDofollow: table.seoLink.lastCheckDofollow,
						lastCheckStatus: table.seoLink.lastCheckStatus,
						price: table.seoLink.price,
						currency: table.seoLink.currency
					})
					.from(table.seoLink)
					.where(
						and(
							eq(table.seoLink.websiteId, website.id),
							eq(table.seoLink.tenantId, tenantId)
						)
					);

				const totalLinks = links.length;
				const publishedLinks = links.filter((l) => l.status === 'published').length;
				const dofollowLinks = links.filter(
					(l) => l.lastCheckDofollow === 'dofollow' || l.linkAttribute === 'dofollow'
				).length;
				const okLinks = links.filter((l) => l.lastCheckStatus === 'ok').length;
				const totalPriceRON = links
					.filter((l) => l.currency === 'RON' && l.price)
					.reduce((acc, l) => acc + (l.price ?? 0), 0);

				return {
					website,
					totalLinks,
					publishedLinks,
					dofollowLinks,
					okLinks,
					totalPriceRON
				};
			})
		);

		return stats;
	}
);

const clientWebsiteSchema = v.object({
	clientId: v.pipe(v.string(), v.minLength(1, 'Clientul este obligatoriu')),
	name: v.optional(v.string()),
	url: v.pipe(v.string(), v.minLength(1, 'URL-ul este obligatoriu')),
	isDefault: v.optional(v.boolean())
});

/** Creează un website nou pentru un client */
export const createClientWebsite = command(clientWebsiteSchema, async (data) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}
	if (event.locals.isClientUser) {
		throw new Error('Unauthorized');
	}

	const websiteId = generateClientWebsiteId();
	const now = new Date();

	// Dacă isDefault, resetează celelalte la false
	if (data.isDefault) {
		await db
			.update(table.clientWebsite)
			.set({ isDefault: false, updatedAt: now })
			.where(
				and(
					eq(table.clientWebsite.clientId, data.clientId),
					eq(table.clientWebsite.tenantId, event.locals.tenant.id)
				)
			);
	}

	// Dacă e primul website al clientului, setează automat ca default
	const existing = await db
		.select({ id: table.clientWebsite.id })
		.from(table.clientWebsite)
		.where(
			and(
				eq(table.clientWebsite.clientId, data.clientId),
				eq(table.clientWebsite.tenantId, event.locals.tenant.id)
			)
		)
		.limit(1);

	const shouldBeDefault = data.isDefault || existing.length === 0;

	await db.insert(table.clientWebsite).values({
		id: websiteId,
		tenantId: event.locals.tenant.id,
		clientId: data.clientId,
		name: data.name || null,
		url: data.url,
		isDefault: shouldBeDefault,
		createdAt: now,
		updatedAt: now
	});

	return { success: true, websiteId };
});

const updateClientWebsiteSchema = v.object({
	websiteId: v.pipe(v.string(), v.minLength(1)),
	name: v.optional(v.nullable(v.string())),
	url: v.optional(v.pipe(v.string(), v.minLength(1))),
	isDefault: v.optional(v.boolean())
});

/** Actualizează un website */
export const updateClientWebsite = command(updateClientWebsiteSchema, async (data) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}
	if (event.locals.isClientUser) {
		throw new Error('Unauthorized');
	}

	const [website] = await db
		.select()
		.from(table.clientWebsite)
		.where(
			and(
				eq(table.clientWebsite.id, data.websiteId),
				eq(table.clientWebsite.tenantId, event.locals.tenant.id)
			)
		)
		.limit(1);

	if (!website) {
		throw new Error('Website-ul nu a fost găsit');
	}

	const now = new Date();

	// Dacă setăm ca default, resetează celelalte
	if (data.isDefault) {
		await db
			.update(table.clientWebsite)
			.set({ isDefault: false, updatedAt: now })
			.where(
				and(
					eq(table.clientWebsite.clientId, website.clientId),
					eq(table.clientWebsite.tenantId, event.locals.tenant.id)
				)
			);
	}

	await db
		.update(table.clientWebsite)
		.set({
			...(data.name !== undefined && { name: data.name }),
			...(data.url !== undefined && { url: data.url }),
			...(data.isDefault !== undefined && { isDefault: data.isDefault }),
			updatedAt: now
		})
		.where(eq(table.clientWebsite.id, data.websiteId));

	return { success: true };
});

/** Șterge un website. Nu permite ștergerea dacă are seo links asociate. */
export const deleteClientWebsite = command(
	v.pipe(v.string(), v.minLength(1)),
	async (websiteId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}
		if (event.locals.isClientUser) {
			throw new Error('Unauthorized');
		}

		const [website] = await db
			.select()
			.from(table.clientWebsite)
			.where(
				and(
					eq(table.clientWebsite.id, websiteId),
					eq(table.clientWebsite.tenantId, event.locals.tenant.id)
				)
			)
			.limit(1);

		if (!website) {
			throw new Error('Website-ul nu a fost găsit');
		}

		// Verificare: nu se poate șterge dacă are seo links
		const [linkCount] = await db
			.select({ count: count() })
			.from(table.seoLink)
			.where(eq(table.seoLink.websiteId, websiteId));

		if (linkCount && linkCount.count > 0) {
			throw new Error(
				`Nu poți șterge acest website — are ${linkCount.count} link${linkCount.count === 1 ? '' : 'uri'} SEO asociate`
			);
		}

		await db.delete(table.clientWebsite).where(eq(table.clientWebsite.id, websiteId));

		return { success: true };
	}
);

/** Setează un website ca principal (default) pentru client */
export const setDefaultClientWebsite = command(
	v.pipe(v.string(), v.minLength(1)),
	async (websiteId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}
		if (event.locals.isClientUser) {
			throw new Error('Unauthorized');
		}

		const [website] = await db
			.select()
			.from(table.clientWebsite)
			.where(
				and(
					eq(table.clientWebsite.id, websiteId),
					eq(table.clientWebsite.tenantId, event.locals.tenant.id)
				)
			)
			.limit(1);

		if (!website) {
			throw new Error('Website-ul nu a fost găsit');
		}

		const now = new Date();

		// Resetează toate la false
		await db
			.update(table.clientWebsite)
			.set({ isDefault: false, updatedAt: now })
			.where(
				and(
					eq(table.clientWebsite.clientId, website.clientId),
					eq(table.clientWebsite.tenantId, event.locals.tenant.id)
				)
			);

		// Setează cel selectat
		await db
			.update(table.clientWebsite)
			.set({ isDefault: true, updatedAt: now })
			.where(eq(table.clientWebsite.id, websiteId));

		return { success: true };
	}
);
