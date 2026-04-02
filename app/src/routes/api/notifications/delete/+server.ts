import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteNotifications } from '$lib/server/notifications';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';

// POST /api/notifications/delete
// Body: { ids: string[] }  — delete specific notifications
//    or { all: true }      — delete all notifications
export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const userId = locals.user.id;

	// Resolve tenantId
	let tenantId = locals.tenant?.id;
	if (!tenantId) {
		const [tu] = await db
			.select({ tenantId: table.tenantUser.tenantId })
			.from(table.tenantUser)
			.where(eq(table.tenantUser.userId, userId))
			.limit(1);
		if (!tu) {
			const [cu] = await db
				.select({ tenantId: table.clientUser.tenantId })
				.from(table.clientUser)
				.where(eq(table.clientUser.userId, userId))
				.limit(1);
			tenantId = cu?.tenantId;
		} else {
			tenantId = tu.tenantId;
		}
	}

	if (!tenantId) {
		return json({ error: 'Tenant not found' }, { status: 400 });
	}

	const clientId = (locals as any).client?.id as string | undefined;

	let body: { ids?: string[]; all?: boolean };
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	let deleted = 0;
	if (body.all === true) {
		deleted = await deleteNotifications(userId, tenantId, undefined, clientId);
	} else if (Array.isArray(body.ids) && body.ids.length > 0) {
		deleted = await deleteNotifications(userId, tenantId, body.ids, clientId);
	} else {
		return json({ error: 'Provide "ids" array or "all: true"' }, { status: 400 });
	}

	return json({ ok: true, deleted });
};
