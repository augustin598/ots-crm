/**
 * Rezervările creditului de ore (spec §3.2): estimările taskurilor deschise, în ore
 * reale. Nu se scriu în ledger — scad doar disponibilul.
 */
import { and, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';

const OPEN_TASK_STATUSES_EXCLUDED = ['done', 'cancelled'] as const;

/**
 * Rezervările (spec §3.2): estimările task-urilor deschise. Ore reale, ca la
 * decontare: 1 h estimată rezervă 1 h de credit, indiferent de specializare.
 */
export async function computeReservedMinutes(
	tenantId: string,
	clientIds: string[]
): Promise<Map<string, number>> {
	const out = new Map<string, number>();
	if (clientIds.length === 0) return out;
	const rows = await db
		.select({
			clientId: table.task.clientId,
			estimatedMinutes: table.task.estimatedMinutes
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
	for (const r of rows) {
		if (!r.clientId || !r.estimatedMinutes) continue;
		out.set(r.clientId, (out.get(r.clientId) ?? 0) + r.estimatedMinutes);
	}
	return out;
}
