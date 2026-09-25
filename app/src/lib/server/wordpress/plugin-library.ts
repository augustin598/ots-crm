import { env } from '$env/dynamic/private';
import { Client as MinioClient } from 'minio';
import { createHash } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { logInfo, logWarning, serializeError } from '$lib/server/logger';
import {
	inspectPluginZip,
	listNestedZips,
	MAX_PLUGIN_ZIP_BYTES,
	normalizePluginZip,
	PluginZipError,
	type PluginZipErrorCode,
	type PluginZipInfo
} from './plugin-zip';
import { decideLibraryUpsert, type LibraryUpsertRelation } from './plugin-library-compare';

/**
 * Tenant plugin library: ZIPs of premium plugins kept in MinIO and described
 * by `wordpress_plugin_library` rows. One row per (tenant, slug) = the newest
 * version the operator uploaded.
 *
 * Storage layout:
 *   wordpress-plugin-library/<tenantId>/<slug>/<version>-<sha256[0:12]>.zip
 *
 * The key is unique per upload and never overwritten: the navitech S3Wrapper
 * keeps serving the OLD bytes of an overwritten key on GET (see
 * connector-release.ts, 2026-07-24), so a re-upload always lands on a fresh
 * key and the previous object is removed best-effort afterwards.
 */

const LIBRARY_PREFIX = 'wordpress-plugin-library';

export type LibraryPluginRow = typeof table.wordpressPluginLibrary.$inferSelect;

function getClient(): MinioClient {
	const endpoint = env.MINIO_ENDPOINT || 'localhost';
	const port = parseInt(env.MINIO_PORT || '9000');
	const useSSL = env.MINIO_USE_SSL === 'true';
	const accessKey = env.MINIO_ACCESS_KEY || 'minioadmin';
	const secretKey = env.MINIO_SECRET_KEY || 'minioadmin';
	return new MinioClient({ endPoint: endpoint, port, useSSL, accessKey, secretKey });
}

/**
 * Same rule as connector releases: the bucket is required, never defaulted.
 * A silent fallback would put the library in the wrong bucket on any
 * environment whose `.env` misses the variable.
 */
function getBucketName(): string {
	const name = env.MINIO_BUCKET_NAME;
	if (!name || name.trim() === '') {
		throw new Error(
			'MINIO_BUCKET_NAME env var is required for the plugin library. Set it in .env (production uses "ots-crm").'
		);
	}
	return name;
}

function newId(): string {
	return encodeBase32LowerCase(globalThis.crypto.getRandomValues(new Uint8Array(15)));
}

/** Object key for one uploaded ZIP. Exported for tests and diagnostics. */
export function libraryObjectKey(
	tenantId: string,
	slug: string,
	version: string,
	sha256: string
): string {
	const safeVersion = version.replace(/[^A-Za-z0-9._-]+/g, '_');
	return `${LIBRARY_PREFIX}/${tenantId}/${slug}/${safeVersion}-${sha256.slice(0, 12)}.zip`;
}

/** The name we hand to WordPress on install; the connector sanitizes again. */
function sanitizeFilename(name: string): string {
	const base = name.split(/[\\/]/).pop() ?? 'plugin.zip';
	const clean = base.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+/, '');
	const withExt = /\.zip$/i.test(clean) ? clean : `${clean || 'plugin'}.zip`;
	return withExt.length > 120 ? withExt.slice(-120) : withExt;
}

async function removeObjectQuietly(
	client: MinioClient,
	bucket: string,
	objectKey: string,
	tenantId: string
): Promise<void> {
	try {
		await client.removeObject(bucket, objectKey);
	} catch (err) {
		const { message } = serializeError(err);
		logWarning('wordpress', `Plugin library: could not remove old object ${objectKey}: ${message}`, {
			tenantId,
			metadata: { objectKey }
		});
	}
}

/** Public shape for the UI: no MinIO key. */
export function serializeLibraryPlugin(row: LibraryPluginRow) {
	return {
		id: row.id,
		slug: row.slug,
		pluginFile: row.pluginFile,
		name: row.name,
		version: row.version,
		description: row.description,
		author: row.author,
		textDomain: row.textDomain,
		pluginUri: row.pluginUri,
		requiresWp: row.requiresWp,
		requiresPhp: row.requiresPhp,
		filename: row.filename,
		sizeBytes: row.sizeBytes,
		sha256: row.sha256,
		uploadedBy: row.uploadedBy,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt
	};
}

export type LibraryPluginItem = ReturnType<typeof serializeLibraryPlugin>;

export async function listLibraryPlugins(tenantId: string): Promise<LibraryPluginRow[]> {
	return db
		.select()
		.from(table.wordpressPluginLibrary)
		.where(eq(table.wordpressPluginLibrary.tenantId, tenantId))
		.orderBy(asc(table.wordpressPluginLibrary.name));
}

export async function getLibraryPlugin(
	tenantId: string,
	id: string
): Promise<LibraryPluginRow | null> {
	const [row] = await db
		.select()
		.from(table.wordpressPluginLibrary)
		.where(
			and(eq(table.wordpressPluginLibrary.id, id), eq(table.wordpressPluginLibrary.tenantId, tenantId))
		)
		.limit(1);
	return row ?? null;
}

export type AddLibraryPluginResult =
	| {
			outcome: 'added' | 'replaced';
			relation: LibraryUpsertRelation;
			row: LibraryPluginRow;
			previousVersion: string | null;
			info: PluginZipInfo;
	  }
	| {
			outcome: 'rejected_older';
			relation: 'older';
			existingId: string;
			existingVersion: string;
			info: PluginZipInfo;
	  };

/**
 * Inspect an uploaded ZIP, then add it to (or replace it in) the library.
 * Throws `PluginZipError` when the archive is not a WordPress plugin. An
 * older version than the one on file is refused unless `force` is set.
 *
 * Order of operations: PUT the new object first, then write the row, then
 * remove the previous object. A crash between the steps leaves at worst an
 * orphan object in MinIO, never a row pointing at missing bytes.
 */
function tooLarge(bytes: number, maxBytes: number): PluginZipError {
	const mb = (n: number) => (n / 1024 / 1024).toFixed(1);
	return new PluginZipError('too_large', `ZIP-ul are ${mb(bytes)} MB, peste limita de ${mb(maxBytes)} MB a conectorului`);
}

export async function addLibraryPlugin(input: {
	tenantId: string;
	userId: string | null;
	filename: string;
	buffer: Buffer;
	force?: boolean;
	/** Defaults to the connector's install cap; tests pass a small value. */
	maxBytes?: number;
}): Promise<AddLibraryPluginResult> {
	const maxBytes = input.maxBytes ?? MAX_PLUGIN_ZIP_BYTES;
	if (input.buffer.length > maxBytes) throw tooLarge(input.buffer.length, maxBytes);

	// Vendor wrapper folder or stray files next to the plugin folder: store
	// the archive the way WordPress needs it.
	const normalized = await normalizePluginZip(input.buffer);
	const buffer = normalized.buffer;
	const info = normalized.info;
	if (normalized.repacked && buffer.length > maxBytes) throw tooLarge(buffer.length, maxBytes);

	const [existing] = await db
		.select()
		.from(table.wordpressPluginLibrary)
		.where(
			and(
				eq(table.wordpressPluginLibrary.tenantId, input.tenantId),
				eq(table.wordpressPluginLibrary.slug, info.slug)
			)
		)
		.limit(1);

	const decision = decideLibraryUpsert(existing?.version ?? null, info.version, input.force === true);
	if (decision.outcome === 'rejected_older') {
		// decideLibraryUpsert only rejects when a row exists; keep TS honest.
		if (!existing) throw new Error('rejected_older without an existing library row');
		return {
			outcome: 'rejected_older',
			relation: 'older',
			existingId: existing.id,
			existingVersion: existing.version,
			info
		};
	}
	const outcome: 'added' | 'replaced' = decision.outcome;

	const sha256 = createHash('sha256').update(buffer).digest('hex');
	const objectKey = libraryObjectKey(input.tenantId, info.slug, info.version, sha256);
	const client = getClient();
	const bucket = getBucketName();

	await client.putObject(bucket, objectKey, buffer, buffer.length, {
		'Content-Type': 'application/zip',
		'X-Ots-Plugin-Slug': info.slug,
		'X-Ots-Plugin-Version': info.version
	});

	const now = new Date();
	const fields = {
		slug: info.slug,
		pluginFile: info.pluginFile,
		name: info.name,
		version: info.version,
		description: info.description,
		author: info.author,
		textDomain: info.textDomain,
		pluginUri: info.pluginUri,
		updateUri: info.updateUri,
		requiresWp: info.requiresWp,
		requiresPhp: info.requiresPhp,
		filename: sanitizeFilename(input.filename),
		sizeBytes: buffer.length,
		sha256,
		objectKey,
		uploadedBy: input.userId,
		updatedAt: now
	};

	let row: LibraryPluginRow;
	if (existing) {
		await db
			.update(table.wordpressPluginLibrary)
			.set(fields)
			.where(
				and(
					eq(table.wordpressPluginLibrary.id, existing.id),
					eq(table.wordpressPluginLibrary.tenantId, input.tenantId)
				)
			);
		row = { ...existing, ...fields };
		if (existing.objectKey !== objectKey) {
			await removeObjectQuietly(client, bucket, existing.objectKey, input.tenantId);
		}
	} else {
		row = { id: newId(), tenantId: input.tenantId, ...fields, createdAt: now };
		await db.insert(table.wordpressPluginLibrary).values(row);
	}

	logInfo(
		'wordpress',
		`Plugin library ${decision.outcome}: ${info.slug} v${info.version}${existing ? ` (was v${existing.version})` : ''}`,
		{
			tenantId: input.tenantId,
			userId: input.userId ?? undefined,
			metadata: {
				slug: info.slug,
				version: info.version,
				previousVersion: existing?.version ?? null,
				relation: decision.relation,
				sizeBytes: buffer.length,
				repacked: buffer !== input.buffer,
				sha256: sha256.slice(0, 12)
			}
		}
	);

	return {
		outcome,
		relation: decision.relation,
		row,
		previousVersion: existing?.version ?? null,
		info
	};
}

/**
 * Read a library ZIP back from MinIO and verify it against the recorded
 * SHA-256 before it is pushed to a site. A corrupted or stale object must
 * never reach a client's WordPress.
 */
export async function fetchLibraryPluginZip(
	row: Pick<LibraryPluginRow, 'objectKey' | 'sha256' | 'slug' | 'version'>
): Promise<Buffer> {
	const client = getClient();
	const bucket = getBucketName();
	const stream = await client.getObject(bucket, row.objectKey);
	const chunks: Buffer[] = [];
	for await (const c of stream) chunks.push(c as Buffer);
	const buffer = Buffer.concat(chunks);
	const actual = createHash('sha256').update(buffer).digest('hex');
	if (actual !== row.sha256) {
		throw new Error(
			`Plugin library ZIP checksum mismatch for ${row.slug} v${row.version}: expected ${row.sha256}, got ${actual}`
		);
	}
	return buffer;
}

/** Delete a library row (tenant-scoped) and its object. Returns the deleted row or null. */
export async function deleteLibraryPlugin(
	tenantId: string,
	id: string
): Promise<LibraryPluginRow | null> {
	const row = await getLibraryPlugin(tenantId, id);
	if (!row) return null;

	await db
		.delete(table.wordpressPluginLibrary)
		.where(
			and(eq(table.wordpressPluginLibrary.id, id), eq(table.wordpressPluginLibrary.tenantId, tenantId))
		);

	await removeObjectQuietly(getClient(), getBucketName(), row.objectKey, tenantId);

	logInfo('wordpress', `Plugin library removed: ${row.slug} v${row.version}`, {
		tenantId,
		metadata: { id, slug: row.slug, version: row.version }
	});
	return row;
}

export type LibraryPackageEntry =
	| ({ filename: string } & AddLibraryPluginResult)
	| { filename: string; outcome: 'error'; code: PluginZipErrorCode | 'unknown'; error: string };

export type AddLibraryUploadResult =
	| { kind: 'plugin'; result: AddLibraryPluginResult }
	| { kind: 'package'; entries: LibraryPackageEntry[] };

/**
 * Entry point for an upload: a plugin ZIP goes straight in; an "unzip
 * first" package (no plugin file at the top level, but inner `.zip`s)
 * has every inner plugin added on its own. The PRO and the free edition
 * shipped together therefore become two library rows. Anything that is
 * neither a plugin nor a package throws the original `no_plugin_file`.
 */
export async function addLibraryUpload(input: {
	tenantId: string;
	userId: string | null;
	filename: string;
	buffer: Buffer;
	force?: boolean;
	maxBytes?: number;
}): Promise<AddLibraryUploadResult> {
	// Decide plugin vs package on the outer archive first: a package may be
	// bigger than one plugin (its inner zips are capped one by one).
	try {
		await inspectPluginZip(input.buffer);
	} catch (err) {
		if (!(err instanceof PluginZipError) || err.code !== 'no_plugin_file') throw err;
		const nested = await listNestedZips(input.buffer, { maxBytes: input.maxBytes });
		if (nested.length === 0) throw err;

		const entries: LibraryPackageEntry[] = [];
		for (const inner of nested) {
			if (!inner.buffer) {
				entries.push({
					filename: inner.filename,
					outcome: 'error',
					code: 'too_large',
					error: `Neinstalabil prin conector: ${inner.skipped ?? 'arhivă prea mare'}`
				});
				continue;
			}
			try {
				const result = await addLibraryPlugin({
					...input,
					filename: inner.filename,
					buffer: inner.buffer
				});
				entries.push({ filename: inner.filename, ...result });
			} catch (innerErr) {
				entries.push({
					filename: inner.filename,
					outcome: 'error',
					code: innerErr instanceof PluginZipError ? innerErr.code : 'unknown',
					error: innerErr instanceof Error ? innerErr.message : String(innerErr)
				});
			}
		}

		const stored = entries.filter((e) => e.outcome === 'added' || e.outcome === 'replaced').length;
		logInfo(
			'wordpress',
			`Plugin library package ${input.filename}: ${nested.length} inner zips, ${stored} stored`,
			{
				tenantId: input.tenantId,
				userId: input.userId ?? undefined,
				metadata: {
					filename: input.filename,
					entries: entries.map((e) => ({ filename: e.filename, outcome: e.outcome }))
				}
			}
		);
		return { kind: 'package', entries };
	}
	return { kind: 'plugin', result: await addLibraryPlugin(input) };
}
