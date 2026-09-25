import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireStaff } from '$lib/server/get-actor';
import { deleteLibraryPlugin } from '$lib/server/wordpress/plugin-library';

/** DELETE — remove one plugin from the tenant's library (row + MinIO object). */
export const DELETE: RequestHandler = async (event) => {
	const { locals, params } = event;
	if (!locals.user || !locals.tenant) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}
	await requireStaff(event);

	const row = await deleteLibraryPlugin(locals.tenant.id, params.id);
	if (!row) {
		return json({ error: 'Nu a fost găsit' }, { status: 404 });
	}
	return json({ success: true, id: row.id, slug: row.slug, version: row.version });
};
