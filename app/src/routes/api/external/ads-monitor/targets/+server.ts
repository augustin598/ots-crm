import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, desc, eq } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { withApiKey } from '$lib/server/api-keys/middleware';

/**
 * GET /api/external/ads-monitor/targets
 * Lists all monitor targets for the tenant. Used by PersonalOPS CEO to
 * survey what's being monitored before taking actions.
 */
export const GET: RequestHandler = (event) =>
	withApiKey(event, 'ads_monitor:read', async (event, ctx) => {
		const url = event.url;
		const clientId = url.searchParams.get('clientId');
		const onlyActive = url.searchParams.get('active') !== 'false';

		const conditions = [eq(table.adMonitorTarget.tenantId, ctx.tenantId)];
		if (clientId) conditions.push(eq(table.adMonitorTarget.clientId, clientId));
		if (onlyActive) conditions.push(eq(table.adMonitorTarget.isActive, true));

		const rows = await db
			.select()
			.from(table.adMonitorTarget)
			.where(and(...conditions))
			.orderBy(desc(table.adMonitorTarget.updatedAt));

		return {
			status: 200,
			body: {
				items: rows,
				total: rows.length
			}
		};
	});

/**
 * POST /api/external/ads-monitor/targets
 * Creates a target programmatically — lets the CEO spawn monitoring on a
 * campaign without going through the CRM UI.
 *
 * Body: { clientId, externalCampaignId, objective, targetCplCents?, targetCpaCents?,
 *         targetRoas?, targetCtr?, targetDailyBudgetCents?, deviationThresholdPct?,
 *         externalAdsetId?, notifyTelegram?, notifyEmail?, notifyInApp? }
 */
export const POST: RequestHandler = (event) =>
	withApiKey(event, 'ads_monitor:write', async (event, ctx) => {
		let body: Record<string, unknown>;
		try {
			body = (await event.request.json()) as Record<string, unknown>;
		} catch {
			return { status: 400, body: { error: 'invalid_json', message: 'Body must be JSON' } };
		}

		const clientId = typeof body.clientId === 'string' ? body.clientId : null;
		const externalCampaignId =
			typeof body.externalCampaignId === 'string' ? body.externalCampaignId : null;
		const objective = typeof body.objective === 'string' ? body.objective : null;

		if (!clientId || !externalCampaignId || !objective) {
			return {
				status: 400,
				body: {
					error: 'missing_fields',
					message: 'clientId, externalCampaignId, and objective are required'
				}
			};
		}

		// Verify client belongs to tenant
		const [clientRow] = await db
			.select({ id: table.client.id })
			.from(table.client)
			.where(and(eq(table.client.id, clientId), eq(table.client.tenantId, ctx.tenantId)))
			.limit(1);
		if (!clientRow) {
			return { status: 404, body: { error: 'client_not_found', message: 'Client not in tenant' } };
		}

		const externalAdsetId =
			typeof body.externalAdsetId === 'string' ? body.externalAdsetId : null;

		// Upsert: if a target already exists for (tenant, campaign, adset), update it.
		const [existing] = await db
			.select({ id: table.adMonitorTarget.id })
			.from(table.adMonitorTarget)
			.where(
				and(
					eq(table.adMonitorTarget.tenantId, ctx.tenantId),
					eq(table.adMonitorTarget.externalCampaignId, externalCampaignId),
					externalAdsetId
						? eq(table.adMonitorTarget.externalAdsetId, externalAdsetId)
						: eq(table.adMonitorTarget.externalCampaignId, externalCampaignId)
				)
			)
			.limit(1);

		const payload = {
			clientId,
			platform: typeof body.platform === 'string' ? body.platform : 'meta',
			externalCampaignId,
			externalAdsetId,
			objective,
			targetCplCents: typeof body.targetCplCents === 'number' ? body.targetCplCents : null,
			targetCpaCents: typeof body.targetCpaCents === 'number' ? body.targetCpaCents : null,
			targetRoas: typeof body.targetRoas === 'number' ? body.targetRoas : null,
			targetCtr: typeof body.targetCtr === 'number' ? body.targetCtr : null,
			targetDailyBudgetCents:
				typeof body.targetDailyBudgetCents === 'number' ? body.targetDailyBudgetCents : null,
			deviationThresholdPct:
				typeof body.deviationThresholdPct === 'number' ? body.deviationThresholdPct : 20,
			notifyTelegram: body.notifyTelegram !== false,
			notifyEmail: body.notifyEmail !== false,
			notifyInApp: body.notifyInApp !== false,
			updatedAt: new Date()
		};

		if (existing) {
			await db
				.update(table.adMonitorTarget)
				.set(payload)
				.where(eq(table.adMonitorTarget.id, existing.id));
			return { status: 200, body: { id: existing.id, updated: true } };
		}

		const id = encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
		await db.insert(table.adMonitorTarget).values({
			id,
			tenantId: ctx.tenantId,
			isActive: true,
			isMuted: false,
			createdByUserId: null,
			...payload
		});

		return { status: 201, body: { id, created: true } };
	});
