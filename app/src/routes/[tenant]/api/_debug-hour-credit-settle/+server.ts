import { json, error } from '@sveltejs/kit';
import { settleTaskCredit, computeReservedMinutes } from '$lib/server/task-credit';
import { getClientHourCredit } from '$lib/server/hour-credits';
import { serializeError } from '$lib/server/logger';
import type { RequestHandler } from './$types';

/**
 * Decontează manual creditul unui task (echivalentul trecerii în Done), ca să poți
 * verifica consumul fără să treci taskul prin tot fluxul de board.
 *
 *   POST { taskId, actualMinutes? }        → decontează
 *   POST { taskId, dryRun: true }          → doar raportează starea curentă
 *
 * Trece prin `settleTaskCredit`, deci respectă ponderarea cu tariful specializării,
 * rotunjirea la pas și idempotența pe `credit_settled_at` — nu scrie SQL pe lângă
 * logica de business. Owner/admin.
 */
function requireAdmin(event: Parameters<RequestHandler>[0]) {
	if (!event.locals.user || !event.locals.tenant) throw error(401, 'Unauthorized');
	const role = event.locals.tenantUser?.role;
	if (role !== 'owner' && role !== 'admin') {
		throw error(403, 'Forbidden: Admin access required');
	}
	return { tenantId: event.locals.tenant.id, userId: event.locals.user.id };
}

export const POST: RequestHandler = async (event) => {
	const { tenantId, userId } = requireAdmin(event);
	const body = (await event.request.json().catch(() => ({}))) as {
		taskId?: string;
		actualMinutes?: number;
		clientId?: string;
		dryRun?: boolean;
	};

	if (!body.taskId) throw error(400, 'taskId lipsește');

	try {
		const result = body.dryRun
			? { status: 'dry-run' as const }
			: await settleTaskCredit({
					tenantId,
					taskId: body.taskId,
					userId,
					actualMinutes: body.actualMinutes ?? null
				});

		// Starea de după, ca să vezi imediat efectul asupra soldului.
		let after: Record<string, unknown> | null = null;
		if (body.clientId) {
			const view = await getClientHourCredit(tenantId, body.clientId, 5);
			const reserved = await computeReservedMinutes(tenantId, [body.clientId]);
			after = {
				balanceMinutes: view?.balanceMinutes ?? null,
				reservedMinutes: reserved.get(body.clientId) ?? 0,
				lastEntries: (view?.entries ?? []).map((e) => ({
					kind: e.kind,
					delta: e.deltaMinutes,
					note: e.note
				}))
			};
		}

		return json({ ok: true, result, after });
	} catch (err) {
		return json({ ok: false, error: serializeError(err).message }, { status: 500 });
	}
};
