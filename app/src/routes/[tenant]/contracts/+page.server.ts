import type { PageServerLoad } from './$types';
import { getContracts } from '$lib/remotes/contracts.remote';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

export const load: PageServerLoad = async (event) => {
	const result = await getContracts({});

	// Fetch clients for display
	const clients = await db
		.select({ id: table.client.id, name: table.client.name, businessName: table.client.businessName })
		.from(table.client)
		.where(eq(table.client.tenantId, event.locals.tenant!.id));

	return { ...result, clients };
};
