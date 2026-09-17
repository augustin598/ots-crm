/**
 * Corecție append-only pe un rând de ledger (spec 2026-09-17 §3-4). Owner-only.
 * POST { ledgerId, deltaMinutes, note }. Idempotent: un singur rând `correction`
 * per rând corectat (index unic) — a doua chemare întoarce applied:false.
 */
import { json, error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { applyLedgerEntry } from '$lib/server/hour-credits';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	if (!event.locals.user || !event.locals.tenant) throw error(401, 'Unauthorized');
	if (event.locals.tenantUser?.role !== 'owner') throw error(403, 'Forbidden: doar owner-ul');
	const tenantId = event.locals.tenant.id;
	const body = (await event.request.json()) as {
		ledgerId?: string;
		deltaMinutes?: number;
		note?: string;
	};
	if (!body.ledgerId || !Number.isInteger(body.deltaMinutes) || body.deltaMinutes === 0) {
		throw error(400, 'ledgerId și deltaMinutes (întreg, nenul) sunt obligatorii');
	}
	if (!body.note || body.note.trim().length < 5) throw error(400, 'nota e obligatorie');
	const [row] = await db
		.select({
			id: table.clientHourLedger.id,
			clientId: table.clientHourLedger.clientId,
			kind: table.clientHourLedger.kind
		})
		.from(table.clientHourLedger)
		.where(
			and(
				eq(table.clientHourLedger.id, body.ledgerId),
				eq(table.clientHourLedger.tenantId, tenantId)
			)
		)
		.limit(1);
	if (!row) throw error(404, 'rândul de ledger nu există');
	if (row.kind === 'correction') throw error(400, 'o corecție nu se corectează');
	const result = await applyLedgerEntry({
		tenantId,
		clientId: row.clientId,
		deltaMinutes: body.deltaMinutes!,
		kind: 'correction',
		sourceType: 'ledger',
		sourceId: row.id,
		note: body.note.trim(),
		createdByUserId: event.locals.user.id
	});
	return json({ applied: result.applied, ledgerId: row.id, deltaMinutes: body.deltaMinutes });
};
