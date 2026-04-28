import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { withApiKey, withIdempotency } from '$lib/server/api-keys/middleware';
import { createDraftCampaign } from '$lib/server/campaigns/draft';
import type { DraftBriefInput } from '$lib/server/campaigns/validate';

export const POST: RequestHandler = (event) =>
	withApiKey(event, 'campaigns:write', async (event, ctx) => {
		const body = (await event.request.json().catch(() => null)) as DraftBriefInput | null;
		if (!body || typeof body !== 'object') {
			return { status: 400, body: { error: 'invalid_body' } };
		}

		const [tenantRow] = await db
			.select({ slug: table.tenant.slug })
			.from(table.tenant)
			.where(eq(table.tenant.id, ctx.tenantId))
			.limit(1);
		if (!tenantRow) return { status: 404, body: { error: 'tenant_not_found' } };

		return withIdempotency(event, ctx, async () => {
			const result = await createDraftCampaign(body, ctx.tenantId, tenantRow.slug, {
				type: 'api_key',
				id: ctx.apiKeyId,
				apiKeyId: ctx.apiKeyId
			});
			return { status: result.status, body: result.body };
		});
	});
