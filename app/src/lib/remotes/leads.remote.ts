import { query, command, getRequestEvent } from '$app/server';
import { error } from '@sveltejs/kit';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and, desc, like, or, sql, inArray, gte, lte, max } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { getAuthenticatedToken } from '$lib/server/meta-ads/auth';
import { listPages } from '$lib/server/meta-ads/client';
import { syncMetaAdsLeadsForTenant, backfillLeadContactFields } from '$lib/server/meta-ads/leads-sync';
import { logInfo } from '$lib/server/logger';

// ---- Queries ----

/** Get leads list with filtering by platform, status, search, pageId, date range, pagination */
export const getLeads = query(
	v.optional(
		v.object({
			platform: v.optional(v.string()),
			status: v.optional(v.string()),
			search: v.optional(v.string()),
			pageId: v.optional(v.string()),
			clientId: v.optional(v.string()),
			formName: v.optional(v.string()),
			dateFrom: v.optional(v.string()),
			dateTo: v.optional(v.string()),
			limit: v.optional(v.number()),
			offset: v.optional(v.number())
		})
	),
	async (filters) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw error(401, 'Unauthorized');
		}

		const tenantId = event.locals.tenant.id;
		const conditions: any[] = [eq(table.lead.tenantId, tenantId)];

		// Client users can only see leads linked to their client
		if (event.locals.isClientUser) {
			if (!event.locals.client?.id) return { rows: [], totalCount: 0 };
			conditions.push(eq(table.lead.clientId, event.locals.client.id));
		}

		if (filters?.platform) {
			conditions.push(eq(table.lead.platform, filters.platform));
		}
		if (filters?.status) {
			conditions.push(eq(table.lead.status, filters.status));
		}
		if (filters?.search) {
			const term = `%${filters.search}%`;
			conditions.push(
				or(
					like(table.lead.fullName, term),
					like(table.lead.email, term),
					like(table.lead.phoneNumber, term)
				)
			);
		}
		if (filters?.pageId) {
			conditions.push(eq(table.lead.pageId, filters.pageId));
		}
		if (filters?.clientId) {
			conditions.push(eq(table.lead.clientId, filters.clientId));
		}
		if (filters?.formName) {
			conditions.push(like(table.lead.formName, `%${filters.formName}%`));
		}
		if (filters?.dateFrom) {
			conditions.push(gte(table.lead.externalCreatedAt, new Date(filters.dateFrom)));
		}
		if (filters?.dateTo) {
			// Add 1 day to include the end date fully
			const endDate = new Date(filters.dateTo);
			endDate.setDate(endDate.getDate() + 1);
			conditions.push(lte(table.lead.externalCreatedAt, endDate));
		}

		const whereClause = and(...conditions);

		const [rows, [countRow]] = await Promise.all([
			db
				.select({
					id: table.lead.id,
					platform: table.lead.platform,
					externalLeadId: table.lead.externalLeadId,
					formName: table.lead.formName,
					fullName: table.lead.fullName,
					email: table.lead.email,
					phoneNumber: table.lead.phoneNumber,
					status: table.lead.status,
					clientId: table.lead.clientId,
					clientName: table.client.name,
					externalCreatedAt: table.lead.externalCreatedAt,
					importedAt: table.lead.importedAt,
					notes: table.lead.notes,
					pageId: table.lead.pageId
				})
				.from(table.lead)
				.leftJoin(table.client, eq(table.lead.clientId, table.client.id))
				.where(whereClause)
				.orderBy(desc(table.lead.externalCreatedAt))
				.limit(filters?.limit || 25)
				.offset(filters?.offset || 0),
			db
				.select({ count: sql<number>`count(*)`.as('count') })
				.from(table.lead)
				.where(whereClause)
		]);

		return { rows, totalCount: countRow?.count || 0 };
	}
);

/** Get a single lead's full details */
export const getLeadDetail = query(
	v.pipe(v.string(), v.minLength(1)),
	async (leadId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw error(401, 'Unauthorized');
		}

		const [row] = await db
			.select({
				id: table.lead.id,
				platform: table.lead.platform,
				externalLeadId: table.lead.externalLeadId,
				externalFormId: table.lead.externalFormId,
				externalAdId: table.lead.externalAdId,
				externalCampaignId: table.lead.externalCampaignId,
				formName: table.lead.formName,
				fullName: table.lead.fullName,
				email: table.lead.email,
				phoneNumber: table.lead.phoneNumber,
				fieldData: table.lead.fieldData,
				status: table.lead.status,
				clientId: table.lead.clientId,
				clientName: table.client.name,
				notes: table.lead.notes,
				externalCreatedAt: table.lead.externalCreatedAt,
				importedAt: table.lead.importedAt,
				createdAt: table.lead.createdAt
			})
			.from(table.lead)
			.leftJoin(table.client, eq(table.lead.clientId, table.client.id))
			.where(
				and(
					eq(table.lead.id, leadId),
					eq(table.lead.tenantId, event.locals.tenant.id),
					...(event.locals.isClientUser && event.locals.client?.id
						? [eq(table.lead.clientId, event.locals.client.id)]
						: [])
				)
			)
			.limit(1);

		if (!row) throw error(404, 'Lead not found');
		return row;
	}
);

/** Get lead stats per platform + status (for parent page cards) */
export const getLeadStats = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw error(401, 'Unauthorized');
	}

	const conditions: any[] = [eq(table.lead.tenantId, event.locals.tenant.id)];

	if (event.locals.isClientUser) {
		if (!event.locals.client?.id) return [];
		conditions.push(eq(table.lead.clientId, event.locals.client.id));
	}

	const rows = await db
		.select({
			platform: table.lead.platform,
			status: table.lead.status,
			count: sql<number>`count(*)`.as('count')
		})
		.from(table.lead)
		.where(and(...conditions))
		.groupBy(table.lead.platform, table.lead.status);

	return rows;
});

/** Get Meta Ads Pages connected for lead monitoring (with lead counts) */
export const getMetaAdsPages = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw error(401, 'Unauthorized');
	}
	// Client users: return only pages linked to their client (basic info)
	if (event.locals.isClientUser) {
		if (!event.locals.client?.id) return [];
		const clientPages = await db
			.select({
				id: table.metaAdsPage.id,
				pageName: table.metaAdsPage.pageName,
				isMonitored: table.metaAdsPage.isMonitored
			})
			.from(table.metaAdsPage)
			.where(
				and(
					eq(table.metaAdsPage.tenantId, event.locals.tenant.id),
					eq(table.metaAdsPage.clientId, event.locals.client.id),
					eq(table.metaAdsPage.isMonitored, true)
				)
			)
			.orderBy(table.metaAdsPage.pageName);
		return clientPages;
	}

	const rows = await db
		.select({
			id: table.metaAdsPage.id,
			integrationId: table.metaAdsPage.integrationId,
			metaPageId: table.metaAdsPage.metaPageId,
			pageName: table.metaAdsPage.pageName,
			isMonitored: table.metaAdsPage.isMonitored,
			lastLeadSyncAt: table.metaAdsPage.lastLeadSyncAt,
			clientId: table.metaAdsPage.clientId,
			businessName: table.metaAdsIntegration.businessName,
			clientName: table.client.name,
			leadCount: sql<number>`(SELECT count(*) FROM lead WHERE lead.page_id = meta_ads_page.id)`.as('lead_count')
		})
		.from(table.metaAdsPage)
		.leftJoin(table.metaAdsIntegration, eq(table.metaAdsPage.integrationId, table.metaAdsIntegration.id))
		.leftJoin(table.client, eq(table.metaAdsPage.clientId, table.client.id))
		.where(eq(table.metaAdsPage.tenantId, event.locals.tenant.id))
		.orderBy(table.metaAdsPage.pageName);

	return rows;
});

/** Get last sync info for the leads page header */
export const getLastSyncInfo = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw error(401, 'Unauthorized');
	}

	const tenantId = event.locals.tenant.id;

	const [result] = await db
		.select({
			lastSyncAt: max(table.metaAdsPage.lastLeadSyncAt),
			monitoredPageCount: sql<number>`count(CASE WHEN ${table.metaAdsPage.isMonitored} = true THEN 1 END)`.as('monitored_count')
		})
		.from(table.metaAdsPage)
		.where(eq(table.metaAdsPage.tenantId, tenantId));

	return {
		lastSyncAt: result?.lastSyncAt || null,
		monitoredPageCount: result?.monitoredPageCount || 0
	};
});

/** Get clients for linking dropdown */
export const getClientsForLeadMapping = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw error(401, 'Unauthorized');
	}
	if (event.locals.isClientUser) return [];

	const clients = await db
		.select({ id: table.client.id, name: table.client.name })
		.from(table.client)
		.where(eq(table.client.tenantId, event.locals.tenant.id))
		.orderBy(table.client.name);

	return clients;
});

// ---- Commands ----

/** Trigger lead sync for a specific platform */
export const triggerLeadSync = command(
	v.object({
		platform: v.pipe(v.string(), v.minLength(1))
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw error(401, 'Unauthorized');
		}
		if (event.locals.isClientUser) throw error(401, 'Unauthorized');

		const tenantId = event.locals.tenant.id;

		if (data.platform === 'facebook') {
			const result = await syncMetaAdsLeadsForTenant(tenantId, 'manual');
			return result;
		}

		// TikTok and Google — future phases
		return { imported: 0, skipped: 0, errors: 0, message: 'Not implemented yet' };
	}
);

/** Backfill contact fields for existing leads from their stored fieldData */
export const backfillLeadContacts = command(
	v.undefined(),
	async () => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw error(401, 'Unauthorized');
		}
		if (event.locals.isClientUser) throw error(401, 'Unauthorized');

		const tenantId = event.locals.tenant.id;
		return await backfillLeadContactFields(tenantId);
	}
);

/** Update a lead's status */
export const updateLeadStatus = command(
	v.object({
		leadId: v.pipe(v.string(), v.minLength(1)),
		status: v.picklist(['new', 'contacted', 'qualified', 'converted', 'disqualified'])
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw error(401, 'Unauthorized');
		}
		if (event.locals.isClientUser) throw error(401, 'Unauthorized');

		await db
			.update(table.lead)
			.set({ status: data.status, updatedAt: new Date() })
			.where(
				and(
					eq(table.lead.id, data.leadId),
					eq(table.lead.tenantId, event.locals.tenant.id)
				)
			);

		return { success: true };
	}
);

/** Bulk update status for multiple leads */
export const bulkUpdateLeadStatus = command(
	v.object({
		leadIds: v.array(v.pipe(v.string(), v.minLength(1))),
		status: v.picklist(['new', 'contacted', 'qualified', 'converted', 'disqualified'])
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw error(401, 'Unauthorized');
		}
		if (event.locals.isClientUser) throw error(401, 'Unauthorized');

		if (data.leadIds.length === 0) return { success: true, updated: 0 };

		await db
			.update(table.lead)
			.set({ status: data.status, updatedAt: new Date() })
			.where(
				and(
					inArray(table.lead.id, data.leadIds),
					eq(table.lead.tenantId, event.locals.tenant.id)
				)
			);

		return { success: true, updated: data.leadIds.length };
	}
);

/** Link a lead to an existing CRM client */
export const linkLeadToClient = command(
	v.object({
		leadId: v.pipe(v.string(), v.minLength(1)),
		clientId: v.pipe(v.string(), v.minLength(1))
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw error(401, 'Unauthorized');
		}
		if (event.locals.isClientUser) throw error(401, 'Unauthorized');

		await db
			.update(table.lead)
			.set({ clientId: data.clientId, updatedAt: new Date() })
			.where(
				and(
					eq(table.lead.id, data.leadId),
					eq(table.lead.tenantId, event.locals.tenant.id)
				)
			);

		return { success: true };
	}
);

/** Add/update notes on a lead */
export const addLeadNote = command(
	v.object({
		leadId: v.pipe(v.string(), v.minLength(1)),
		notes: v.string()
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw error(401, 'Unauthorized');
		}
		if (event.locals.isClientUser) throw error(401, 'Unauthorized');

		await db
			.update(table.lead)
			.set({ notes: data.notes, updatedAt: new Date() })
			.where(
				and(
					eq(table.lead.id, data.leadId),
					eq(table.lead.tenantId, event.locals.tenant.id)
				)
			);

		return { success: true };
	}
);

/** Fetch available Facebook Pages from Meta API (for page selection UI) */
export const fetchAvailablePages = command(
	v.pipe(v.string(), v.minLength(1)),
	async (integrationId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw error(401, 'Unauthorized');
		}
		if (event.locals.isClientUser) throw error(401, 'Unauthorized');

		const auth = await getAuthenticatedToken(integrationId);
		if (!auth) throw error(400, 'Failed to get auth token');

		const pages = await listPages(auth.accessToken, env.META_APP_SECRET!);
		return pages;
	}
);

/** Add a Facebook Page for lead monitoring */
export const addMetaAdsPage = command(
	v.object({
		integrationId: v.pipe(v.string(), v.minLength(1)),
		metaPageId: v.pipe(v.string(), v.minLength(1)),
		pageName: v.string(),
		pageAccessToken: v.pipe(v.string(), v.minLength(1))
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw error(401, 'Unauthorized');
		}
		if (event.locals.isClientUser) throw error(401, 'Unauthorized');

		const tenantId = event.locals.tenant.id;

		// Check if page already exists
		const [existing] = await db
			.select({ id: table.metaAdsPage.id })
			.from(table.metaAdsPage)
			.where(
				and(
					eq(table.metaAdsPage.metaPageId, data.metaPageId),
					eq(table.metaAdsPage.tenantId, tenantId)
				)
			)
			.limit(1);

		if (existing) {
			// Update existing
			await db
				.update(table.metaAdsPage)
				.set({
					pageAccessToken: data.pageAccessToken,
					pageName: data.pageName,
					isMonitored: true,
					updatedAt: new Date()
				})
				.where(eq(table.metaAdsPage.id, existing.id));
			return { success: true, action: 'updated' };
		}

		try {
			await db.insert(table.metaAdsPage).values({
				id: crypto.randomUUID(),
				tenantId,
				integrationId: data.integrationId,
				metaPageId: data.metaPageId,
				pageName: data.pageName || '',
				pageAccessToken: data.pageAccessToken,
				isMonitored: true,
				createdAt: new Date(),
				updatedAt: new Date()
			});
		} catch (dbErr) {
			console.error('[META-ADS] DB insert error for page:', data.metaPageId, dbErr);
			throw dbErr;
		}

		return { success: true, action: 'added' };
	}
);

/** Remove a Facebook Page from monitoring */
export const removeMetaAdsPage = command(
	v.pipe(v.string(), v.minLength(1)),
	async (pageId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw error(401, 'Unauthorized');
		}
		if (event.locals.isClientUser) throw error(401, 'Unauthorized');

		await db
			.delete(table.metaAdsPage)
			.where(
				and(
					eq(table.metaAdsPage.id, pageId),
					eq(table.metaAdsPage.tenantId, event.locals.tenant.id)
				)
			);

		return { success: true };
	}
);

/** Toggle lead monitoring for a page */
export const togglePageMonitoring = command(
	v.object({
		pageId: v.pipe(v.string(), v.minLength(1)),
		isMonitored: v.boolean()
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw error(401, 'Unauthorized');
		}
		if (event.locals.isClientUser) throw error(401, 'Unauthorized');

		await db
			.update(table.metaAdsPage)
			.set({ isMonitored: data.isMonitored, updatedAt: new Date() })
			.where(
				and(
					eq(table.metaAdsPage.id, data.pageId),
					eq(table.metaAdsPage.tenantId, event.locals.tenant.id)
				)
			);

		return { success: true };
	}
);

/** Assign a CRM client to a Facebook Page (for lead tracking) */
export const assignPageToClient = command(
	v.object({
		pageId: v.pipe(v.string(), v.minLength(1)),
		clientId: v.union([v.pipe(v.string(), v.minLength(1)), v.literal(''), v.null()])
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw error(401, 'Unauthorized');
		}
		if (event.locals.isClientUser) throw error(401, 'Unauthorized');

		const tenantId = event.locals.tenant.id;

		const [pageRow] = await db
			.select({ id: table.metaAdsPage.id })
			.from(table.metaAdsPage)
			.where(
				and(
					eq(table.metaAdsPage.id, data.pageId),
					eq(table.metaAdsPage.tenantId, tenantId)
				)
			)
			.limit(1);

		if (!pageRow) throw error(404, 'Pagina nu a fost găsită');

		const clientId = data.clientId || null;

		if (clientId) {
			const [clientRow] = await db
				.select({ id: table.client.id })
				.from(table.client)
				.where(
					and(
						eq(table.client.id, clientId),
						eq(table.client.tenantId, tenantId)
					)
				)
				.limit(1);

			if (!clientRow) throw error(404, 'Clientul nu a fost găsit');
		}

		await db
			.update(table.metaAdsPage)
			.set({ clientId, updatedAt: new Date() })
			.where(eq(table.metaAdsPage.id, data.pageId));

		return { success: true };
	}
);

/** Convert a lead into a new CRM client */
export const convertLeadToClient = command(
	v.pipe(v.string(), v.minLength(1)),
	async (leadId) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw error(401, 'Unauthorized');
		}
		if (event.locals.isClientUser) throw error(401, 'Unauthorized');

		const tenantId = event.locals.tenant.id;

		const [leadRow] = await db
			.select()
			.from(table.lead)
			.where(
				and(
					eq(table.lead.id, leadId),
					eq(table.lead.tenantId, tenantId)
				)
			)
			.limit(1);

		if (!leadRow) throw error(404, 'Lead not found');

		// Create new client from lead data
		const clientId = crypto.randomUUID();
		await db.insert(table.client).values({
			id: clientId,
			tenantId,
			name: leadRow.fullName || leadRow.email || 'New Client',
			email: leadRow.email || '',
			phone: leadRow.phoneNumber || '',
			createdAt: new Date(),
			updatedAt: new Date()
		});

		// Link lead to client and mark as converted
		await db
			.update(table.lead)
			.set({
				clientId,
				status: 'converted',
				updatedAt: new Date()
			})
			.where(eq(table.lead.id, leadId));

		logInfo('meta-ads-leads', `Converted lead to client`, {
			tenantId,
			metadata: { leadId, clientId, name: leadRow.fullName }
		});

		return { success: true, clientId };
	}
);
