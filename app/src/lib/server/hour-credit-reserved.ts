/**
 * Rezervările creditului de ore (spec §3.2): estimările taskurilor deschise,
 * ponderate cu catalogul curent. Nu se scriu în ledger — scad doar disponibilul.
 */
import { and, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { logWarning, serializeError } from '$lib/server/logger';
import { getHourlyCatalog } from '$lib/server/hourly-catalog';
import { resolveReferenceRate } from '$lib/logic/hourly-catalog';
import { weightFactor, weightedMinutes } from '$lib/logic/hour-credits';

const OPEN_TASK_STATUSES_EXCLUDED = ['done', 'cancelled'] as const;

/** Rezervările (spec §3.2): estimările task-urilor deschise, ponderate cu catalogul curent. */
export async function computeReservedMinutes(
	tenantId: string,
	clientIds: string[]
): Promise<Map<string, number>> {
	const out = new Map<string, number>();
	if (clientIds.length === 0) return out;
	const rows = await db
		.select({
			clientId: table.task.clientId,
			estimatedMinutes: table.task.estimatedMinutes,
			rateSlug: table.task.rateSlug,
			modeSlug: table.task.modeSlug
		})
		.from(table.task)
		.where(
			and(
				eq(table.task.tenantId, tenantId),
				inArray(table.task.clientId, clientIds),
				notInArray(table.task.status, [...OPEN_TASK_STATUSES_EXCLUDED]),
				isNull(table.task.creditSettledAt),
				sql`${table.task.estimatedMinutes} > 0`
			)
		);
	if (rows.length === 0) return out;
	const catalog = await getHourlyCatalog(tenantId, { includeInactive: true });
	const reference = resolveReferenceRate(catalog.rates, catalog.rules);
	for (const r of rows) {
		if (!r.clientId || !r.estimatedMinutes) continue;
		let minutes = r.estimatedMinutes;
		if (reference) {
			const rate = catalog.rates.find((x) => x.slug === r.rateSlug) ?? reference;
			const mode = catalog.modes.find((m) => m.slug === (r.modeSlug ?? 'standard'));
			try {
				minutes = weightedMinutes(
					r.estimatedMinutes,
					weightFactor(rate.rateEur, mode?.multiplierPct ?? 100, reference.rateEur)
				);
			} catch (err) {
				logWarning(
					'server',
					`task-credit: rezervare neponderată — ${serializeError(err).message}`,
					{ tenantId }
				);
			}
		}
		out.set(r.clientId, (out.get(r.clientId) ?? 0) + minutes);
	}
	return out;
}
