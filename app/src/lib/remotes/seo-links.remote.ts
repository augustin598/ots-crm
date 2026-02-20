import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';

function generateSeoLinkId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

const seoLinkSchema = v.object({
	clientId: v.pipe(v.string(), v.minLength(1, 'Client is required')),
	pressTrust: v.optional(v.string()),
	month: v.pipe(v.string(), v.minLength(1, 'Luna este obligatorie')), // YYYY-MM
	keyword: v.pipe(v.string(), v.minLength(1, 'Cuvântul cheie este obligatoriu')),
	linkType: v.optional(v.picklist(['article', 'guest-post', 'press-release', 'directory', 'other'])),
	linkAttribute: v.optional(v.picklist(['dofollow', 'nofollow'])),
	status: v.optional(v.picklist(['pending', 'submitted', 'published', 'rejected'])),
	articleUrl: v.pipe(v.string(), v.minLength(1, 'Linkul articolului este obligatoriu')),
	price: v.optional(v.number()),
	currency: v.optional(v.string()),
	anchorText: v.optional(v.string()),
	projectId: v.optional(v.string()),
	notes: v.optional(v.string())
});

export const getSeoLinks = query(
	v.object({
		clientId: v.optional(v.string()),
		month: v.optional(v.string()),
		status: v.optional(v.string())
	}),
	async (filters) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		let conditions = eq(table.seoLink.tenantId, event.locals.tenant.id);

		if (filters.clientId) {
			conditions = and(conditions, eq(table.seoLink.clientId, filters.clientId)) as typeof conditions;
		}
		if (filters.month) {
			conditions = and(conditions, eq(table.seoLink.month, filters.month)) as typeof conditions;
		}
		if (filters.status) {
			conditions = and(conditions, eq(table.seoLink.status, filters.status)) as typeof conditions;
		}

		const links = await db
			.select()
			.from(table.seoLink)
			.where(conditions)
			.orderBy(desc(table.seoLink.month), desc(table.seoLink.createdAt));

		return links;
	}
);

export const createSeoLink = command(seoLinkSchema, async (data) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	const [invoiceSettings] = await db
		.select()
		.from(table.invoiceSettings)
		.where(eq(table.invoiceSettings.tenantId, event.locals.tenant.id))
		.limit(1);

	const currency = data.currency || invoiceSettings?.defaultCurrency || 'RON';

	const seoLinkId = generateSeoLinkId();

	await db.insert(table.seoLink).values({
		id: seoLinkId,
		tenantId: event.locals.tenant.id,
		clientId: data.clientId,
		pressTrust: data.pressTrust || null,
		month: data.month,
		keyword: data.keyword,
		linkType: data.linkType || null,
		linkAttribute: data.linkAttribute || 'dofollow',
		status: data.status || 'pending',
		articleUrl: data.articleUrl,
		price: data.price != null ? Math.round(data.price * 100) : null,
		currency,
		anchorText: data.anchorText || null,
		projectId: data.projectId || null,
		notes: data.notes || null
	});

	return { success: true, seoLinkId };
});

export const getSeoLink = query(
	v.pipe(v.string(), v.minLength(1)),
	async (seoLinkId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		const [link] = await db
			.select()
			.from(table.seoLink)
			.where(
				and(
					eq(table.seoLink.id, seoLinkId),
					eq(table.seoLink.tenantId, event.locals.tenant.id)
				)
			)
			.limit(1);

		if (!link) {
			throw new Error('Link SEO nu a fost găsit');
		}

		return link;
	}
);

export const updateSeoLink = command(
	v.object({
		seoLinkId: v.pipe(v.string(), v.minLength(1)),
		...seoLinkSchema.entries
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		const { seoLinkId, ...updateData } = data;

		const [existing] = await db
			.select()
			.from(table.seoLink)
			.where(
				and(
					eq(table.seoLink.id, seoLinkId),
					eq(table.seoLink.tenantId, event.locals.tenant.id)
				)
			)
			.limit(1);

		if (!existing) {
			throw new Error('Link SEO nu a fost găsit');
		}

		await db
			.update(table.seoLink)
			.set({
				clientId: updateData.clientId ?? existing.clientId,
				pressTrust: updateData.pressTrust !== undefined ? updateData.pressTrust : existing.pressTrust,
				month: updateData.month ?? existing.month,
				keyword: updateData.keyword ?? existing.keyword,
				linkType: updateData.linkType !== undefined ? updateData.linkType : existing.linkType,
				linkAttribute: updateData.linkAttribute ?? existing.linkAttribute,
				status: updateData.status ?? existing.status,
				articleUrl: updateData.articleUrl ?? existing.articleUrl,
				price:
					updateData.price != null
						? Math.round(updateData.price * 100)
						: existing.price,
				currency: updateData.currency ?? existing.currency,
				anchorText:
					updateData.anchorText !== undefined ? updateData.anchorText : existing.anchorText,
				projectId: updateData.projectId !== undefined ? updateData.projectId : existing.projectId,
				notes: updateData.notes !== undefined ? updateData.notes : existing.notes,
				updatedAt: new Date()
			})
			.where(eq(table.seoLink.id, seoLinkId));

		return { success: true };
	}
);

export const deleteSeoLink = command(
	v.pipe(v.string(), v.minLength(1)),
	async (seoLinkId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		const [existing] = await db
			.select()
			.from(table.seoLink)
			.where(
				and(
					eq(table.seoLink.id, seoLinkId),
					eq(table.seoLink.tenantId, event.locals.tenant.id)
				)
			)
			.limit(1);

		if (!existing) {
			throw new Error('Link SEO nu a fost găsit');
		}

		await db.delete(table.seoLink).where(eq(table.seoLink.id, seoLinkId));

		return { success: true };
	}
);
