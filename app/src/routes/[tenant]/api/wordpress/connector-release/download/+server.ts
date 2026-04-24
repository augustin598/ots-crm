import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	fetchConnectorRelease,
	getLatestConnectorRelease
} from '$lib/server/wordpress/connector-release';

/**
 * GET — stream the OTS Connector ZIP to the operator's browser.
 *
 *   - Default: latest published release.
 *   - `?version=X.Y.Z`: pin to a specific release (e.g. to manually
 *     downgrade a site or re-download after tampering).
 *
 * Proxies through the CRM rather than returning a presigned MinIO URL.
 * Cleaner UX (single Download button that just works), consistent
 * Content-Disposition header, and keeps the MinIO bucket private.
 * ZIP is ~18 KB today, so the proxy cost is negligible.
 */
export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.user || !locals.tenant) {
		throw error(401, 'Unauthorized');
	}

	const pinnedVersion = url.searchParams.get('version');
	let targetVersion: string;
	if (pinnedVersion) {
		targetVersion = pinnedVersion;
	} else {
		const latest = await getLatestConnectorRelease();
		if (!latest) {
			throw error(404, 'Nicio versiune publicată. Rulează bun run connector:release.');
		}
		targetVersion = latest.version;
	}

	let buffer: Buffer;
	try {
		const fetched = await fetchConnectorRelease(targetVersion);
		buffer = fetched.buffer;
	} catch (err) {
		throw error(
			500,
			`Nu am putut citi ZIP-ul v${targetVersion} din MinIO: ${
				err instanceof Error ? err.message : 'unknown'
			}`
		);
	}

	const filename = `ots-wp-connector-v${targetVersion}.zip`;
	// Buffer is a Uint8Array subclass, but DOM types don't love SharedArrayBuffer
	// unions that come off of Node's Buffer prototype. Copy into a plain
	// Uint8Array so `Response` accepts it as BodyInit cleanly.
	const body = new Uint8Array(buffer);
	return new Response(body, {
		status: 200,
		headers: {
			'Content-Type': 'application/zip',
			'Content-Length': String(buffer.length),
			'Content-Disposition': `attachment; filename="${filename}"`,
			// Don't cache: if the operator re-requests, they probably just
			// published a new version.
			'Cache-Control': 'no-store'
		}
	});
};
