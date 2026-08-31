import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, asc, eq } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import type { FixedCostRow, FixedFrequency } from '$lib/logic/interviuri-kpi';

/**
 * Cheltuieli fixe de marketing (pagina KPI Performanță). Sumele stau în DB în
 * cenți; spre UI/logică pleacă în lei (FixedCostRow).
 */

export function generateFixedCostId(): string {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

/** Rândurile implicite din prototip (seed la prima folosire + „Resetează la implicit"). */
export const DEFAULT_FIXED_COSTS: Array<
	Pick<
		table.NewMarketingFixedCost,
		'name' | 'note' | 'qty' | 'unitAmountCents' | 'unitLabel' | 'frequency' | 'sortOrder'
	>
> = [
	{
		name: 'Echipă marketing',
		note: 'salarii brute',
		qty: 4,
		unitAmountCents: 800000,
		unitLabel: 'persoane',
		frequency: 'monthly',
		sortOrder: 10
	},
	{
		name: 'Abonamente & tooling',
		note: 'Canva, Metricool, ChatGPT, Ahrefs',
		qty: 1,
		unitAmountCents: 94000,
		unitLabel: 'pachet',
		frequency: 'monthly',
		sortOrder: 20
	},
	{
		name: 'Producție content',
		note: 'filmări + editare clipuri',
		qty: 1,
		unitAmountCents: 250000,
		unitLabel: 'pachet',
		frequency: 'monthly',
		sortOrder: 30
	}
];

export function toFixedCostRow(r: table.MarketingFixedCost): FixedCostRow {
	return {
		id: r.id,
		name: r.name,
		note: r.note,
		qty: r.qty,
		unitAmount: r.unitAmountCents / 100,
		unitLabel: r.unitLabel,
		frequency: (r.frequency === 'yearly' ? 'yearly' : 'monthly') as FixedFrequency,
		active: r.active,
		validFrom: r.validFrom,
		validTo: r.validTo
	};
}

export async function insertDefaultFixedCosts(tenantId: string, userId: string | null): Promise<void> {
	const now = new Date();
	await db.insert(table.marketingFixedCost).values(
		DEFAULT_FIXED_COSTS.map((d) => ({
			id: generateFixedCostId(),
			tenantId,
			...d,
			active: true,
			createdBy: userId,
			createdAt: now,
			updatedAt: now
		}))
	);
}

/** Seed idempotent la prima citire (ca ensureChannelsSeeded). */
export async function ensureFixedCostsSeeded(tenantId: string, userId: string | null): Promise<void> {
	const existing = await db
		.select({ id: table.marketingFixedCost.id })
		.from(table.marketingFixedCost)
		.where(eq(table.marketingFixedCost.tenantId, tenantId))
		.limit(1);
	if (existing.length > 0) return;
	await insertDefaultFixedCosts(tenantId, userId);
}

export async function listFixedCosts(tenantId: string): Promise<FixedCostRow[]> {
	const rows = await db
		.select()
		.from(table.marketingFixedCost)
		.where(eq(table.marketingFixedCost.tenantId, tenantId))
		.orderBy(asc(table.marketingFixedCost.sortOrder), asc(table.marketingFixedCost.createdAt));
	return rows.map(toFixedCostRow);
}

/** Șterge TOATE rândurile tenantului și reinserează implicitele. */
export async function resetFixedCosts(tenantId: string, userId: string | null): Promise<void> {
	await db.delete(table.marketingFixedCost).where(eq(table.marketingFixedCost.tenantId, tenantId));
	await insertDefaultFixedCosts(tenantId, userId);
}

/** WHERE pe id ȘI tenant — niciodată pe id singur. */
export function fixedCostWhere(tenantId: string, id: string) {
	return and(eq(table.marketingFixedCost.id, id), eq(table.marketingFixedCost.tenantId, tenantId));
}
