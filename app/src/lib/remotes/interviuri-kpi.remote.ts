import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { requireStaff } from '$lib/server/get-actor';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { loadInterviewKpiData } from '$lib/server/interviuri/kpi-data';
import {
	ensureFixedCostsSeeded,
	fixedCostWhere,
	generateFixedCostId,
	listFixedCosts,
	resetFixedCosts
} from '$lib/server/interviuri/fixed-costs';
import { syncMetaAdsInvoicesForTenant } from '$lib/server/meta-ads/sync';
import { syncTiktokAdsSpendingForTenant } from '$lib/server/tiktok-ads/sync';
import { syncGoogleAdsInvoicesForTenant } from '$lib/server/google-ads/sync';
import { logError } from '$lib/server/logger';
import { PLATFORMS, type PlatformId } from '$lib/logic/interviuri-kpi';

/**
 * Pagina Interviuri → KPI Performanță (cost pe interviu).
 * Citire: orice user staff (ca pagina Interviuri). Scriere pe cheltuielile fixe:
 * doar owner/admin. Userii de portal sunt respinși de requireStaff.
 */

function requireCtx() {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) throw new Error('Unauthorized');
	return event;
}
async function requireStaffCtx() {
	const event = requireCtx();
	await requireStaff(event);
	return event;
}
function isMarketingAdmin(event: ReturnType<typeof requireCtx>): boolean {
	const role = event.locals.tenantUser?.role;
	return role === 'owner' || role === 'admin';
}
async function requireMarketingAdminCtx() {
	const event = await requireStaffCtx();
	if (!isMarketingAdmin(event)) throw new Error('Doar Owner/Admin pot modifica cheltuielile fixe');
	return event;
}

// ===================== Queries =====================

export const getInterviewKpiData = query(
	v.optional(
		v.object({
			year: v.optional(v.pipe(v.number(), v.integer(), v.minValue(2000), v.maxValue(2100)))
		})
	),
	async (args) => {
		const event = await requireStaffCtx();
		return loadInterviewKpiData(event.locals.tenant!.id, args?.year);
	}
);

export const getMarketingFixedCosts = query(async () => {
	const event = await requireStaffCtx();
	const tenantId = event.locals.tenant!.id;
	await ensureFixedCostsSeeded(tenantId, event.locals.user!.id);
	return { rows: await listFixedCosts(tenantId), canEdit: isMarketingAdmin(event) };
});

// ===================== Commands =====================

const monthRe = /^\d{4}-(0[1-9]|1[0-2])$/;
const fixedCostFields = {
	name: v.optional(v.pipe(v.string(), v.maxLength(120))),
	note: v.optional(v.nullable(v.pipe(v.string(), v.maxLength(300)))),
	qty: v.optional(v.pipe(v.number(), v.minValue(0), v.maxValue(1_000_000))),
	unitAmount: v.optional(v.pipe(v.number(), v.minValue(0), v.maxValue(1_000_000_000))),
	unitLabel: v.optional(v.nullable(v.pipe(v.string(), v.maxLength(40)))),
	frequency: v.optional(v.picklist(['monthly', 'yearly'])),
	active: v.optional(v.boolean()),
	validFrom: v.optional(v.nullable(v.pipe(v.string(), v.regex(monthRe, 'Lună invalidă (YYYY-MM)')))),
	validTo: v.optional(v.nullable(v.pipe(v.string(), v.regex(monthRe, 'Lună invalidă (YYYY-MM)'))))
};
const fixedCostPatchSchema = v.object(fixedCostFields);
type FixedCostPatch = v.InferOutput<typeof fixedCostPatchSchema>;

/** lei → cenți; câmpurile absente rămân neatinse. */
function toDbPatch(data: FixedCostPatch) {
	const set: Partial<table.NewMarketingFixedCost> = {};
	if (data.name !== undefined) set.name = data.name.trim();
	if (data.note !== undefined) set.note = data.note?.trim() || null;
	if (data.qty !== undefined) set.qty = data.qty;
	if (data.unitAmount !== undefined) set.unitAmountCents = Math.round(data.unitAmount * 100);
	if (data.unitLabel !== undefined) set.unitLabel = data.unitLabel?.trim() || null;
	if (data.frequency !== undefined) set.frequency = data.frequency;
	if (data.active !== undefined) set.active = data.active;
	if (data.validFrom !== undefined) set.validFrom = data.validFrom || null;
	if (data.validTo !== undefined) set.validTo = data.validTo || null;
	if (set.validFrom && set.validTo && set.validFrom > set.validTo) {
		throw new Error('„Valabil de la" nu poate fi după „până la"');
	}
	return set;
}

export const createMarketingFixedCost = command(
	v.optional(fixedCostPatchSchema),
	async (data) => {
		const event = await requireMarketingAdminCtx();
		const tenantId = event.locals.tenant!.id;
		const id = generateFixedCostId();
		const now = new Date();
		await db.insert(table.marketingFixedCost).values({
			id,
			tenantId,
			name: '',
			qty: 1,
			unitAmountCents: 0,
			frequency: 'monthly',
			active: true,
			// rândurile noi merg la coadă, după implicitele 10/20/30
			sortOrder: 100 + (now.getTime() % 100000),
			...toDbPatch(data ?? {}),
			createdBy: event.locals.user!.id,
			createdAt: now,
			updatedAt: now
		});
		return { success: true, id };
	}
);

export const updateMarketingFixedCost = command(
	v.object({ id: v.pipe(v.string(), v.minLength(1)), ...fixedCostFields }),
	async ({ id, ...data }) => {
		const event = await requireMarketingAdminCtx();
		const updated = await db
			.update(table.marketingFixedCost)
			.set({ ...toDbPatch(data), updatedAt: new Date() })
			.where(fixedCostWhere(event.locals.tenant!.id, id))
			.returning({ id: table.marketingFixedCost.id });
		if (updated.length === 0) throw new Error('Rândul nu a fost găsit');
		return { success: true };
	}
);

export const deleteMarketingFixedCost = command(v.pipe(v.string(), v.minLength(1)), async (id) => {
	const event = await requireMarketingAdminCtx();
	const deleted = await db
		.delete(table.marketingFixedCost)
		.where(fixedCostWhere(event.locals.tenant!.id, id))
		.returning({ id: table.marketingFixedCost.id });
	if (deleted.length === 0) throw new Error('Rândul nu a fost găsit');
	return { success: true };
});

export const resetMarketingFixedCosts = command(async () => {
	const event = await requireMarketingAdminCtx();
	await resetFixedCosts(event.locals.tenant!.id, event.locals.user!.id);
	return { success: true };
});

export interface SyncPlatformResult {
	id: PlatformId;
	label: string;
	ok: boolean;
	error?: string;
}

/** Re-sincronizează cele trei conturi; o platformă picată nu blochează restul. */
export const syncInterviewAdsBudgets = command(async () => {
	const event = await requireStaffCtx();
	const tenantId = event.locals.tenant!.id;
	const runners: Record<PlatformId, () => Promise<unknown>> = {
		meta: () => syncMetaAdsInvoicesForTenant(tenantId),
		tiktok: () => syncTiktokAdsSpendingForTenant(tenantId),
		google: () => syncGoogleAdsInvoicesForTenant(tenantId)
	};
	const results: SyncPlatformResult[] = [];
	for (const p of PLATFORMS) {
		try {
			await runners[p.id]();
			results.push({ id: p.id, label: p.label, ok: true });
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			logError('interviuri-kpi', `Sync ${p.id} failed: ${message}`, {
				tenantId,
				userId: event.locals.user!.id
			});
			results.push({ id: p.id, label: p.label, ok: false, error: message.slice(0, 200) });
		}
	}
	return { results, syncedAt: new Date().toISOString() };
});
