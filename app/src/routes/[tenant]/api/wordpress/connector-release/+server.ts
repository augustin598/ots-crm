import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getLatestConnectorRelease } from '$lib/server/wordpress/connector-release';

/**
 * GET — returns metadata for the latest published OTS Connector release.
 * Used by the WP sites dashboard to show "update available" indicators
 * next to sites whose `connectorVersion` is older than the latest.
 *
 * Returns 200 with `{ latest: null }` when no release has been published,
 * rather than 404 — the dashboard renders an empty state then.
 */
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user || !locals.tenant) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const latest = await getLatestConnectorRelease();

	return json({
		latest: latest
			? {
					version: latest.version,
					uploadedAt: latest.uploadedAt,
					size: latest.size,
					sha256: latest.sha256,
					notes: latest.notes ?? null
				}
			: null
	});
};
