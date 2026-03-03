import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { disconnectGmail } from '$lib/server/gmail/auth';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

export const POST: RequestHandler = async ({ request }) => {
	const { tenant } = await request.json();
	console.log('[Gmail API /disconnect] Received request, tenant slug:', tenant);

	if (!tenant) {
		return json({ error: 'Tenant is required' }, { status: 400 });
	}

	// Resolve tenant slug to id
	const [tenantRow] = await db
		.select({ id: table.tenant.id })
		.from(table.tenant)
		.where(eq(table.tenant.slug, tenant))
		.limit(1);

	if (!tenantRow) {
		console.error('[Gmail API /disconnect] Tenant not found for slug:', tenant);
		return json({ error: 'Tenant not found' }, { status: 404 });
	}

	console.log('[Gmail API /disconnect] Resolved tenant id:', tenantRow.id);

	try {
		await disconnectGmail(tenantRow.id);
		console.log('[Gmail API /disconnect] Disconnect successful');
		return json({ success: true });
	} catch (err) {
		console.error('[Gmail API /disconnect] Error:', err);
		return json({ error: 'Failed to disconnect' }, { status: 500 });
	}
};
