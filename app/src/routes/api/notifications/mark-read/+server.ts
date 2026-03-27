import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { markNotificationsRead } from '$lib/server/notifications';

// POST /api/notifications/mark-read
// Body: { ids: string[] }  — mark specific notifications
//    or { all: true }      — mark all notifications as read
export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user || !locals.tenant) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const userId = locals.user.id;
	const tenantId = locals.tenant.id;

	let body: { ids?: string[]; all?: boolean };
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	if (body.all === true) {
		await markNotificationsRead(userId, tenantId);
	} else if (Array.isArray(body.ids) && body.ids.length > 0) {
		await markNotificationsRead(userId, tenantId, body.ids);
	} else {
		return json({ error: 'Provide "ids" array or "all: true"' }, { status: 400 });
	}

	return json({ ok: true });
};
