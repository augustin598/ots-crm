import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, count, sql } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';

function generateClientWebsiteId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

/** Returnează toate website-urile tuturor clienților unui tenant (bulk, pentru listări) */
export const getAllClientWebsites = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	return db
		.select()
		.from(table.clientWebsite)
		.where(eq(table.clientWebsite.tenantId, event.locals.tenant.id));
});

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

		const rows = await db
			.select({
				website: table.clientWebsite,
				totalLinks: sql<number>`count(${table.seoLink.id})`.as('total_links'),
				publishedLinks:
					sql<number>`sum(case when ${table.seoLink.status} = 'published' then 1 else 0 end)`.as(
						'published_links'
					),
				dofollowLinks:
					sql<number>`sum(case when ${table.seoLink.lastCheckDofollow} = 'dofollow' or ${table.seoLink.linkAttribute} = 'dofollow' then 1 else 0 end)`.as(
						'dofollow_links'
					),
				okLinks:
					sql<number>`sum(case when ${table.seoLink.lastCheckStatus} = 'ok' then 1 else 0 end)`.as(
						'ok_links'
					),
				totalPriceRON:
					sql<number>`coalesce(sum(case when ${table.seoLink.currency} = 'RON' then ${table.seoLink.price} else 0 end), 0)`.as(
						'total_price_ron'
					)
			})
			.from(table.clientWebsite)
			.leftJoin(
				table.seoLink,
				and(
					eq(table.seoLink.websiteId, table.clientWebsite.id),
					eq(table.seoLink.tenantId, tenantId)
				)
			)
			.where(
				and(
					eq(table.clientWebsite.clientId, clientId),
					eq(table.clientWebsite.tenantId, tenantId)
				)
			)
			.groupBy(table.clientWebsite.id);

		return rows.map((row) => ({
			website: row.website,
			totalLinks: row.totalLinks || 0,
			publishedLinks: row.publishedLinks || 0,
			dofollowLinks: row.dofollowLinks || 0,
			okLinks: row.okLinks || 0,
			totalPriceRON: row.totalPriceRON || 0
		}));
	}
);

const clientWebsiteSchema = v.object({
	clientId: v.pipe(v.string(), v.minLength(1, 'Clientul este obligatoriu')),
	name: v.optional(v.string()),
	url: v.pipe(v.string(), v.minLength(1, 'URL-ul este obligatoriu'), v.maxLength(500), v.url('URL invalid')),
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

	// Verify client belongs to tenant
	const [clientBelongsToTenant] = await db
		.select({ id: table.client.id })
		.from(table.client)
		.where(
			and(eq(table.client.id, data.clientId), eq(table.client.tenantId, event.locals.tenant.id))
		)
		.limit(1);

	if (!clientBelongsToTenant) {
		throw new Error('Client not found');
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

		await db.transaction(async (tx) => {
			// Resetează toate la false
			await tx
				.update(table.clientWebsite)
				.set({ isDefault: false, updatedAt: now })
				.where(
					and(
						eq(table.clientWebsite.clientId, website.clientId),
						eq(table.clientWebsite.tenantId, event.locals.tenant.id)
					)
				);

			// Setează cel selectat
			await tx
				.update(table.clientWebsite)
				.set({ isDefault: true, updatedAt: now })
				.where(eq(table.clientWebsite.id, websiteId));
		});

		return { success: true };
	}
);
