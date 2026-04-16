import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async (event) => {
	const tenantId = event.locals.tenant?.id;
	if (!tenantId) return { lastKeezSyncAt: null };

	const [integration] = await db
		.select({ lastSyncAt: table.keezIntegration.lastSyncAt })
		.from(table.keezIntegration)
		.where(eq(table.keezIntegration.tenantId, tenantId))
		.limit(1);

	return {
		lastKeezSyncAt: integration?.lastSyncAt?.toISOString() ?? null
	};
};
