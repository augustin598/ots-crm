import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { logInfo, logError, serializeError } from '$lib/server/logger';
import type { RequestHandler } from './$types';

async function findTarget(tenantId: string, id: string) {
	const [row] = await db
		.select()
		.from(table.adMonitorTarget)
		.where(and(eq(table.adMonitorTarget.id, id), eq(table.adMonitorTarget.tenantId, tenantId)))
		.limit(1);
	return row ?? null;
}

export const PATCH: RequestHandler = async ({ params, locals, request }) => {
	if (!locals.user || !locals.tenant) throw error(401, 'Unauthorized');
	if (!params.id) throw error(400, 'Missing id');

	const target = await findTarget(locals.tenant.id, params.id);
	if (!target) throw error(404, 'Target inexistent');

	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		throw error(400, 'JSON invalid');
	}

	const updates: Record<string, unknown> = { updatedAt: new Date() };

	if (typeof body.targetCplCents === 'number' || body.targetCplCents === null)
		updates.targetCplCents = body.targetCplCents;
	if (typeof body.targetCpaCents === 'number' || body.targetCpaCents === null)
		updates.targetCpaCents = body.targetCpaCents;
	if (typeof body.targetRoas === 'number' || body.targetRoas === null)
		updates.targetRoas = body.targetRoas;
	if (typeof body.targetCtr === 'number' || body.targetCtr === null)
		updates.targetCtr = body.targetCtr;
	if (typeof body.targetDailyBudgetCents === 'number' || body.targetDailyBudgetCents === null)
		updates.targetDailyBudgetCents = body.targetDailyBudgetCents;
	if (typeof body.deviationThresholdPct === 'number')
		updates.deviationThresholdPct = body.deviationThresholdPct;
	if (typeof body.isActive === 'boolean') updates.isActive = body.isActive;
	if (typeof body.notifyTelegram === 'boolean') updates.notifyTelegram = body.notifyTelegram;
	if (typeof body.notifyEmail === 'boolean') updates.notifyEmail = body.notifyEmail;
	if (typeof body.notifyInApp === 'boolean') updates.notifyInApp = body.notifyInApp;

	// Mute/unmute support
	if (body.action === 'mute') {
		const days = typeof body.days === 'number' ? body.days : 7;
		updates.isMuted = true;
		updates.mutedUntil = new Date(Date.now() + days * 86400_000);
	} else if (body.action === 'unmute') {
		updates.isMuted = false;
		updates.mutedUntil = null;
	}

	try {
		await db
			.update(table.adMonitorTarget)
			.set(updates)
			.where(
				and(eq(table.adMonitorTarget.id, params.id), eq(table.adMonitorTarget.tenantId, locals.tenant.id))
			);
		logInfo('ads-monitor', `Target updated: ${params.id}`, {
			tenantId: locals.tenant.id,
			userId: locals.user.id,
			metadata: { targetId: params.id, action: body.action ?? 'update' }
		});
		return json({ ok: true });
	} catch (e) {
		logError('ads-monitor', `Failed to update target ${params.id}: ${serializeError(e).message}`, {
			tenantId: locals.tenant.id
		});
		throw error(500, 'Eroare la salvarea target-ului');
	}
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user || !locals.tenant) throw error(401, 'Unauthorized');
	if (!params.id) throw error(400, 'Missing id');

	try {
		await db
			.delete(table.adMonitorTarget)
			.where(
				and(eq(table.adMonitorTarget.id, params.id), eq(table.adMonitorTarget.tenantId, locals.tenant.id))
			);
		return json({ ok: true });
	} catch (e) {
		logError('ads-monitor', `Failed to delete target ${params.id}: ${serializeError(e).message}`, {
			tenantId: locals.tenant.id
		});
		throw error(500, 'Eroare la ștergerea target-ului');
	}
};
