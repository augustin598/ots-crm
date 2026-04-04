import { query, command, getRequestEvent } from '$app/server';
import { error } from '@sveltejs/kit';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';

function generateId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

const filtersSchema = v.object({
	datePreset: v.nullable(v.string()),
	since: v.nullable(v.string()),
	until: v.nullable(v.string()),
	accountId: v.string(),
	columnPreset: v.string(),
	objectiveFilter: v.string(),
	statusFilter: v.string(),
	pageSize: v.pipe(v.number(), v.minValue(1))
});

export type SavedViewFilters = v.InferOutput<typeof filtersSchema>;

const DEFAULT_FILTERS: SavedViewFilters = {
	datePreset: null, since: null, until: null,
	accountId: '', columnPreset: 'performance_clicks',
	objectiveFilter: 'all', statusFilter: 'all', pageSize: 25
};

/** Get all saved views for the current tenant + platform */
export const getSavedViews = query(
	v.object({ platform: v.picklist(['meta', 'google', 'tiktok']) }),
	async (params) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw error(401, 'Unauthorized');
		}

		const views = await db
			.select({
				id: table.savedReportView.id,
				name: table.savedReportView.name,
				platform: table.savedReportView.platform,
				filters: table.savedReportView.filters,
				isDefault: table.savedReportView.isDefault,
				userId: table.savedReportView.userId,
				userName: table.user.firstName,
				createdAt: table.savedReportView.createdAt,
				updatedAt: table.savedReportView.updatedAt
			})
			.from(table.savedReportView)
			.leftJoin(table.user, eq(table.savedReportView.userId, table.user.id))
			.where(
				and(
					eq(table.savedReportView.tenantId, event.locals.tenant.id),
					eq(table.savedReportView.platform, params.platform)
				)
			)
			.orderBy(table.savedReportView.name);

		return views.map(row => {
			// Safe JSON parse — never crash the whole query for one corrupt row
			let filters: SavedViewFilters;
			try {
				filters = JSON.parse(row.filters || '{}') as SavedViewFilters;
			} catch {
				filters = { ...DEFAULT_FILTERS };
			}
			return {
				...row,
				filters,
				isOwner: row.userId === event.locals.user!.id
			};
		});
	}
);

/** Create a new saved view */
export const createSavedView = command(
	v.object({
		name: v.pipe(v.string(), v.minLength(1), v.maxLength(100)),
		platform: v.picklist(['meta', 'google', 'tiktok']),
		filters: filtersSchema,
		isDefault: v.optional(v.boolean(), false)
	}),
	async (params) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw error(401, 'Unauthorized');
		}

		const tenantId = event.locals.tenant.id;
		const userId = event.locals.user.id;

		// If setting as default, clear existing defaults for this user+platform
		if (params.isDefault) {
			await db
				.update(table.savedReportView)
				.set({ isDefault: false, updatedAt: new Date() })
				.where(
					and(
						eq(table.savedReportView.tenantId, tenantId),
						eq(table.savedReportView.userId, userId),
						eq(table.savedReportView.platform, params.platform),
						eq(table.savedReportView.isDefault, true)
					)
				);
		}

		const id = generateId();
		await db.insert(table.savedReportView).values({
			id,
			tenantId,
			userId,
			name: params.name,
			platform: params.platform,
			filters: JSON.stringify(params.filters),
			isDefault: params.isDefault ?? false,
			createdAt: new Date(),
			updatedAt: new Date()
		});

		return { id };
	}
);

/** Update an existing saved view (owner only, tenant-isolated) */
export const updateSavedView = command(
	v.object({
		id: v.pipe(v.string(), v.minLength(1)),
		name: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(100))),
		filters: v.optional(filtersSchema),
		isDefault: v.optional(v.boolean())
	}),
	async (params) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw error(401, 'Unauthorized');
		}

		const tenantId = event.locals.tenant.id;

		// Verify ownership + tenant isolation
		const [existing] = await db
			.select({ userId: table.savedReportView.userId, platform: table.savedReportView.platform })
			.from(table.savedReportView)
			.where(
				and(
					eq(table.savedReportView.id, params.id),
					eq(table.savedReportView.tenantId, tenantId)
				)
			)
			.limit(1);

		if (!existing) throw error(404, 'Vizualizarea nu a fost găsită');
		if (existing.userId !== event.locals.user.id) throw error(403, 'Nu poți modifica vizualizările altor utilizatori');

		// If setting as default, clear existing
		if (params.isDefault) {
			await db
				.update(table.savedReportView)
				.set({ isDefault: false, updatedAt: new Date() })
				.where(
					and(
						eq(table.savedReportView.tenantId, tenantId),
						eq(table.savedReportView.userId, event.locals.user.id),
						eq(table.savedReportView.platform, existing.platform),
						eq(table.savedReportView.isDefault, true)
					)
				);
		}

		const updates: Partial<typeof table.savedReportView.$inferInsert> = { updatedAt: new Date() };
		if (params.name !== undefined) updates.name = params.name;
		if (params.filters !== undefined) updates.filters = JSON.stringify(params.filters);
		if (params.isDefault !== undefined) updates.isDefault = params.isDefault;

		await db
			.update(table.savedReportView)
			.set(updates)
			.where(eq(table.savedReportView.id, params.id));

		return { success: true };
	}
);

/** Delete a saved view (owner only, tenant-isolated) */
export const deleteSavedView = command(
	v.object({ id: v.pipe(v.string(), v.minLength(1)) }),
	async (params) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw error(401, 'Unauthorized');
		}

		// Verify ownership + tenant isolation
		const [existing] = await db
			.select({ userId: table.savedReportView.userId })
			.from(table.savedReportView)
			.where(
				and(
					eq(table.savedReportView.id, params.id),
					eq(table.savedReportView.tenantId, event.locals.tenant.id)
				)
			)
			.limit(1);

		if (!existing) throw error(404, 'Vizualizarea nu a fost găsită');
		if (existing.userId !== event.locals.user.id) throw error(403, 'Nu poți șterge vizualizările altor utilizatori');

		await db.delete(table.savedReportView).where(eq(table.savedReportView.id, params.id));

		return { success: true };
	}
);
