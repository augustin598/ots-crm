import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireStaff } from '$lib/server/get-actor';
import { logError, logWarning, serializeError } from '$lib/server/logger';
import {
	addLibraryUpload,
	listLibraryPlugins,
	serializeLibraryPlugin,
	type LibraryPackageEntry
} from '$lib/server/wordpress/plugin-library';
import { PluginZipError } from '$lib/server/wordpress/plugin-zip';

/** One inner plugin of an "unzip first" package, as sent to the UI. */
function serializePackageEntry(e: LibraryPackageEntry) {
	if (e.outcome === 'error') {
		return { filename: e.filename, outcome: 'error' as const, code: e.code, error: e.error };
	}
	if (e.outcome === 'rejected_older') {
		return {
			filename: e.filename,
			outcome: 'rejected_older' as const,
			existingVersion: e.existingVersion,
			existingId: e.existingId,
			info: e.info,
			error: `Biblioteca are deja v${e.existingVersion} pentru ${e.info.slug}; pachetul conține v${e.info.version}`
		};
	}
	return {
		filename: e.filename,
		outcome: e.outcome,
		relation: e.relation,
		previousVersion: e.previousVersion,
		item: serializeLibraryPlugin(e.row)
	};
}

/** Base64 inflates by ~4/3: 70M chars ≈ 52 MB decoded, just above the 50 MB cap. */
const MAX_BASE64_CHARS = 70_000_000;
const MAX_ZIP_BYTES = 50 * 1024 * 1024;

/** GET — the tenant's plugin library, alphabetical by name. */
export const GET: RequestHandler = async (event) => {
	const { locals } = event;
	if (!locals.user || !locals.tenant) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}
	await requireStaff(event);

	const rows = await listLibraryPlugins(locals.tenant.id);
	return json({ items: rows.map(serializeLibraryPlugin) });
};

/**
 * POST — add one plugin ZIP to the library. The UI sends one request per
 * file so it can show per-file progress. Body: { filename, dataBase64, force? }.
 *
 *   200 { outcome: 'added' | 'replaced', relation, previousVersion, item }
 *   200 { outcome: 'package', entries: [...] }  — "unzip first" archive: one
 *        entry per inner plugin zip (added / replaced / rejected_older / error)
 *   400 { error, code }  — the archive is neither a WordPress plugin nor a package
 *   409 { error, code: 'older_version', existingVersion, existingId, info }
 *        — an older version than the one on file; resend with force=true
 */
export const POST: RequestHandler = async (event) => {
	const { locals, request } = event;
	if (!locals.user || !locals.tenant) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}
	await requireStaff(event);
	const tenantId = locals.tenant.id;
	const userId = locals.user.id;

	const body = (await request.json().catch(() => null)) as {
		filename?: unknown;
		dataBase64?: unknown;
		force?: unknown;
	} | null;
	if (typeof body?.filename !== 'string' || typeof body?.dataBase64 !== 'string' || !body.filename || !body.dataBase64) {
		return json({ error: 'filename și dataBase64 sunt obligatorii' }, { status: 400 });
	}
	if (body.dataBase64.length > MAX_BASE64_CHARS) {
		return json({ error: 'ZIP depășește 50 MB' }, { status: 413 });
	}
	const buffer = Buffer.from(body.dataBase64, 'base64');
	if (buffer.length === 0) {
		return json({ error: 'ZIP gol' }, { status: 400 });
	}
	if (buffer.length > MAX_ZIP_BYTES) {
		return json({ error: 'ZIP depășește 50 MB' }, { status: 413 });
	}

	try {
		const upload = await addLibraryUpload({
			tenantId,
			userId,
			filename: body.filename,
			buffer,
			force: body.force === true
		});

		if (upload.kind === 'package') {
			return json({ outcome: 'package', entries: upload.entries.map(serializePackageEntry) });
		}
		const result = upload.result;

		if (result.outcome === 'rejected_older') {
			return json(
				{
					error: `Biblioteca are deja v${result.existingVersion} pentru ${result.info.slug}; arhiva urcată e v${result.info.version}`,
					code: 'older_version',
					existingVersion: result.existingVersion,
					existingId: result.existingId,
					info: result.info
				},
				{ status: 409 }
			);
		}

		return json({
			outcome: result.outcome,
			relation: result.relation,
			previousVersion: result.previousVersion,
			item: serializeLibraryPlugin(result.row)
		});
	} catch (err) {
		if (err instanceof PluginZipError) {
			logWarning('wordpress', `Plugin library upload rejected: ${body.filename} [${err.code}]`, {
				tenantId,
				userId,
				metadata: { filename: body.filename, code: err.code }
			});
			return json({ error: err.message, code: err.code }, { status: err.code === 'too_large' ? 413 : 400 });
		}
		const { message, stack } = serializeError(err);
		logError('wordpress', `Plugin library upload failed: ${body.filename}: ${message}`, {
			tenantId,
			userId,
			metadata: { filename: body.filename, stackTrace: stack }
		});
		return json({ error: `Nu am putut salva arhiva: ${message}` }, { status: 500 });
	}
};
