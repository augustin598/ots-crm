import { query, getRequestEvent } from '$app/server';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

export const getTenantUsers = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	// Get all users that belong to this tenant via tenant_user table
	const tenantUsers = await db
		.select({
			id: table.user.id,
			email: table.user.email,
			firstName: table.user.firstName,
			lastName: table.user.lastName
		})
		.from(table.tenantUser)
		.innerJoin(table.user, eq(table.tenantUser.userId, table.user.id))
		.where(eq(table.tenantUser.tenantId, event.locals.tenant.id));

	return tenantUsers;
});
