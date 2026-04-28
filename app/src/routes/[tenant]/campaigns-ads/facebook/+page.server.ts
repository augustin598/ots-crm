import { fail, redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, desc, eq } from 'drizzle-orm';
import { applyCampaignAction, type CampaignAction } from '$lib/server/campaigns/patch';

export const load: PageServerLoad = async (event) => {
	if (!event.locals.user || !event.locals.tenant) throw redirect(302, '/login');
	const tenantId = event.locals.tenant.id;

	const statusFilter = event.url.searchParams.get('status');

	const conditions = [eq(table.campaign.tenantId, tenantId), eq(table.campaign.platform, 'meta')];
	if (statusFilter) conditions.push(eq(table.campaign.status, statusFilter));

	const rows = await db
		.select({
			id: table.campaign.id,
			clientId: table.campaign.clientId,
			platform: table.campaign.platform,
			status: table.campaign.status,
			buildStep: table.campaign.buildStep,
			name: table.campaign.name,
			objective: table.campaign.objective,
			budgetType: table.campaign.budgetType,
			budgetCents: table.campaign.budgetCents,
			currencyCode: table.campaign.currencyCode,
			createdByWorkerId: table.campaign.createdByWorkerId,
			createdAt: table.campaign.createdAt,
			approvedAt: table.campaign.approvedAt,
			lastError: table.campaign.lastError,
			audienceJson: table.campaign.audienceJson,
			creativeJson: table.campaign.creativeJson,
			briefJson: table.campaign.briefJson,
			externalCampaignId: table.campaign.externalCampaignId,
			externalAdAccountId: table.campaign.externalAdAccountId,
			clientName: table.client.name,
			adAccountName: table.metaAdsAccount.accountName
		})
		.from(table.campaign)
		.leftJoin(table.client, eq(table.campaign.clientId, table.client.id))
		.leftJoin(
			table.metaAdsAccount,
			and(
				eq(table.metaAdsAccount.metaAdAccountId, table.campaign.externalAdAccountId),
				eq(table.metaAdsAccount.tenantId, tenantId)
			)
		)
		.where(and(...conditions))
		.orderBy(desc(table.campaign.createdAt))
		.limit(100);

	const counts = await db
		.select({
			status: table.campaign.status,
			count: table.campaign.id
		})
		.from(table.campaign)
		.where(and(eq(table.campaign.tenantId, tenantId), eq(table.campaign.platform, 'meta')));

	const byStatus = counts.reduce<Record<string, number>>((acc, r) => {
		acc[r.status] = (acc[r.status] ?? 0) + 1;
		return acc;
	}, {});

	return {
		platform: 'meta' as const,
		campaigns: rows.map((r) => ({
			...r,
			audience: safeParse(r.audienceJson),
			creative: safeParse(r.creativeJson),
			brief: safeParse(r.briefJson)
		})),
		statusFilter: statusFilter ?? '',
		counts: byStatus
	};
};

export const actions: Actions = {
	patch: async (event) => {
		if (!event.locals.user || !event.locals.tenant) throw redirect(302, '/login');
		const tenantId = event.locals.tenant.id;

		const formData = await event.request.formData();
		const id = String(formData.get('id') ?? '');
		const action = String(formData.get('action') ?? '') as CampaignAction;

		if (!id || !['approve', 'pause', 'archive'].includes(action)) {
			return fail(400, { error: 'invalid_input' });
		}

		const result = await applyCampaignAction({
			campaignId: id,
			tenantId,
			action,
			actor: { type: 'user', id: event.locals.user.id, userId: event.locals.user.id }
		});

		if (result.status >= 400) {
			return fail(result.status, result.body);
		}
		return { success: true, ...result.body };
	}
};

function safeParse(json: string): unknown {
	try {
		return JSON.parse(json);
	} catch {
		return null;
	}
}
