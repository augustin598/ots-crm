import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq, desc } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { logInfo, logError, serializeError } from '$lib/server/logger';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.user || !locals.tenant) throw error(401, 'Unauthorized');

	const clientId = url.searchParams.get('clientId');
	const conditions = [eq(table.adMonitorTarget.tenantId, locals.tenant.id)];
	if (clientId) conditions.push(eq(table.adMonitorTarget.clientId, clientId));

	const rows = await db
		.select()
		.from(table.adMonitorTarget)
		.where(and(...conditions))
		.orderBy(desc(table.adMonitorTarget.updatedAt));

	return json({ targets: rows });
};

export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user || !locals.tenant) throw error(401, 'Unauthorized');

	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		throw error(400, 'JSON invalid');
	}

	const clientId = typeof body.clientId === 'string' ? body.clientId : null;
	const externalCampaignId =
		typeof body.externalCampaignId === 'string' ? body.externalCampaignId : null;
	const objective = typeof body.objective === 'string' ? body.objective : null;

	if (!clientId || !externalCampaignId || !objective) {
		throw error(400, 'clientId, externalCampaignId și objective sunt obligatorii');
	}

	// Verify client belongs to tenant
	const [clientRow] = await db
		.select({ id: table.client.id })
		.from(table.client)
		.where(and(eq(table.client.id, clientId), eq(table.client.tenantId, locals.tenant.id)))
		.limit(1);
	if (!clientRow) throw error(404, 'Client inexistent');

	const externalAdsetId =
		typeof body.externalAdsetId === 'string' ? body.externalAdsetId : null;

	// Reject duplicate target for same campaign+adset
	const [existing] = await db
		.select({ id: table.adMonitorTarget.id })
		.from(table.adMonitorTarget)
		.where(
			and(
				eq(table.adMonitorTarget.tenantId, locals.tenant.id),
				eq(table.adMonitorTarget.externalCampaignId, externalCampaignId),
				externalAdsetId
					? eq(table.adMonitorTarget.externalAdsetId, externalAdsetId)
					: eq(table.adMonitorTarget.externalCampaignId, externalCampaignId)
			)
		)
		.limit(1);
	if (existing) throw error(409, 'Există deja un target pentru această campanie/adset');

	const id = encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
	const platform = typeof body.platform === 'string' ? body.platform : 'meta';
	const deviationThresholdPct =
		typeof body.deviationThresholdPct === 'number' ? body.deviationThresholdPct : 20;

	try {
		await db.insert(table.adMonitorTarget).values({
			id,
			tenantId: locals.tenant.id,
			clientId,
			platform,
			externalCampaignId,
			externalAdsetId,
			objective,
			targetCplCents:
				typeof body.targetCplCents === 'number' ? body.targetCplCents : null,
			targetCpaCents:
				typeof body.targetCpaCents === 'number' ? body.targetCpaCents : null,
			targetRoas: typeof body.targetRoas === 'number' ? body.targetRoas : null,
			targetCtr: typeof body.targetCtr === 'number' ? body.targetCtr : null,
			targetDailyBudgetCents:
				typeof body.targetDailyBudgetCents === 'number'
					? body.targetDailyBudgetCents
					: null,
			deviationThresholdPct,
			isActive: true,
			isMuted: false,
			notifyTelegram: body.notifyTelegram !== false,
			notifyEmail: body.notifyEmail !== false,
			notifyInApp: body.notifyInApp !== false,
			createdByUserId: locals.user.id
		});
		logInfo('ads-monitor', `Target created: ${id} for campaign ${externalCampaignId}`, {
			tenantId: locals.tenant.id,
			userId: locals.user.id,
			metadata: { targetId: id, externalCampaignId }
		});
		return json({ id }, { status: 201 });
	} catch (e) {
		logError('ads-monitor', `Failed to create target: ${serializeError(e).message}`, {
			tenantId: locals.tenant.id
		});
		throw error(500, 'Eroare la crearea target-ului');
	}
};
