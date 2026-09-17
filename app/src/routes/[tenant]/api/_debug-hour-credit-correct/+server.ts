/**
 * Corecție append-only pe un rând de ledger (spec 2026-09-17 §3-4). Owner-only.
 * POST { ledgerId, deltaMinutes, note }. Idempotent: un singur rând `correction`
 * per rând corectat (index unic) — a doua chemare întoarce applied:false.
 * Ce rânduri se pot corecta și cu cât: `assertLedgerRowCorrectable`.
 */
import { json, error } from '@sveltejs/kit';
import { applyLedgerEntry, assertLedgerRowCorrectable } from '$lib/server/hour-credits';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	if (!event.locals.user || !event.locals.tenant) throw error(401, 'Unauthorized');
	if (event.locals.tenantUser?.role !== 'owner') throw error(403, 'Forbidden: doar owner-ul');
	const tenantId = event.locals.tenant.id;
	// Corp JSON invalid → 400, nu 500.
	const body = (await event.request.json().catch(() => null)) as {
		ledgerId?: string;
		deltaMinutes?: number;
		note?: string;
	} | null;
	if (!body || typeof body !== 'object') throw error(400, 'corpul cererii trebuie să fie JSON');
	if (
		typeof body.ledgerId !== 'string' ||
		!body.ledgerId ||
		!Number.isInteger(body.deltaMinutes) ||
		body.deltaMinutes === 0
	) {
		throw error(400, 'ledgerId și deltaMinutes (întreg, nenul) sunt obligatorii');
	}
	if (typeof body.note !== 'string' || body.note.trim().length < 5) {
		throw error(400, 'nota e obligatorie');
	}
	const check = await assertLedgerRowCorrectable(tenantId, body.ledgerId, body.deltaMinutes!);
	if (!check.ok) throw error(check.reason === 'not_found' ? 404 : 400, check.message);
	const row = check.row;
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
