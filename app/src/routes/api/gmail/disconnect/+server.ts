import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { disconnectGmail } from '$lib/server/gmail/auth';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

export const POST: RequestHandler = async ({ request }) => {
	const { tenant } = await request.json();

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
		return json({ error: 'Tenant not found' }, { status: 404 });
	}

	try {
		await disconnectGmail(tenantRow.id);
		return json({ success: true });
	} catch (err) {
		return json({ error: 'Failed to disconnect' }, { status: 500 });
	}
};
