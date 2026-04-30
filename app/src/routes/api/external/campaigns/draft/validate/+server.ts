import type { RequestHandler } from './$types';
import { withApiKey } from '$lib/server/api-keys/middleware';
import { validateDraftBrief, type DraftBriefInput } from '$lib/server/campaigns/validate';

export const POST: RequestHandler = (event) =>
	withApiKey(event, 'campaigns:write', async (event, ctx) => {
		const body = (await event.request.json().catch(() => null)) as DraftBriefInput | null;
		if (!body || typeof body !== 'object') {
			return { status: 400, body: { error: 'invalid_body' } };
		}

		const result = await validateDraftBrief(body, ctx.tenantId);
		return {
			status: 200,
			body: {
				valid: result.valid,
				errors: result.errors,
				expandedSpec: result.expandedSpec ?? null,
				resolved: result.resolved ?? null
			}
		};
	});
