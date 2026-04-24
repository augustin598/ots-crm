import { env } from '$env/dynamic/private';
import { Client as MinioClient } from 'minio';
import crypto from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { logError, logInfo, serializeError } from '$lib/server/logger';

/**
 * Storage layout for OTS Connector release artifacts on MinIO.
 *
 *   ots-connector/releases/v0.6.4/ots-wp-connector.zip
 *   ots-connector/releases/v0.6.4/metadata.json
 *   ots-connector/latest.json              ← rolling pointer to newest version
 *
 * The `latest.json` pointer is a separate object so the "current latest"
 * can be rolled forward atomically (a single PUT) without touching the
 * versioned artifacts. This also makes it cheap for clients to poll for
 * updates: one tiny JSON fetch.
 *
 * All reads go through a presigned URL — MinIO buckets are private by
 * default, and even if we switch to public ACL later, presigned URLs
 * keep the audit trail intact.
 */

const CONNECTOR_PREFIX = 'ots-connector/releases';
const LATEST_POINTER = 'ots-connector/latest.json';

export interface ConnectorReleaseMetadata {
	/** Semantic version, without the "v" prefix. */
	version: string;
	/** SHA-256 hex digest of the ZIP payload. */
	sha256: string;
	size: number;
	uploadedAt: string; // ISO 8601
	uploadedBy?: string; // user id or 'build-script'
	/** Object key within the bucket. */
	objectKey: string;
	/** Human-readable changelog line (optional). */
	notes?: string;
}

/** MinIO client that is shared with the main storage layer but scoped
 *  to connector-release operations. We don't reuse the existing
 *  `getMinioClient()` directly to keep side effects (bucket creation)
 *  isolated — connector releases have slightly different semantics
 *  (long retention, small objects, cross-tenant).
 */
function getClient(): MinioClient {
	const endpoint = env.MINIO_ENDPOINT || 'localhost';
	const port = parseInt(env.MINIO_PORT || '9000');
	const useSSL = env.MINIO_USE_SSL === 'true';
	const accessKey = env.MINIO_ACCESS_KEY || 'minioadmin';
	const secretKey = env.MINIO_SECRET_KEY || 'minioadmin';
	return new MinioClient({ endPoint: endpoint, port, useSSL, accessKey, secretKey });
}

/**
 * Bucket name is intentionally required — silently falling back to
 * `'crm-documents'` (the original default) would upload connector
 * releases to the wrong bucket in any environment whose `.env` happens
 * to miss the variable. The resulting "releases exist but can't be
 * fetched" state is one of the hardest bugs to diagnose.
 */
function getBucketName(): string {
	const name = env.MINIO_BUCKET_NAME;
	if (!name || name.trim() === '') {
		throw new Error(
			'MINIO_BUCKET_NAME env var is required for connector release operations. ' +
				'Set it in .env (production uses "ots-crm").'
		);
	}
	return name;
}

/**
 * Upload a connector ZIP buffer as a versioned release, and roll the
 * `latest.json` pointer forward. Returns the metadata that was stored.
 *
 * Idempotent: re-uploading the same version overwrites both artifacts.
 * That's intentional — makes `publish.sh` safe to run twice in a row
 * during development without generating duplicate objects.
 */
export async function uploadConnectorRelease(
	zipBuffer: Buffer,
	version: string,
	uploadedBy?: string,
	notes?: string
): Promise<ConnectorReleaseMetadata> {
	const client = getClient();
	const bucket = getBucketName();

	const zipObjectKey = `${CONNECTOR_PREFIX}/v${version}/ots-wp-connector.zip`;
	const metaObjectKey = `${CONNECTOR_PREFIX}/v${version}/metadata.json`;

	const sha256 = crypto.createHash('sha256').update(zipBuffer).digest('hex');

	const metadata: ConnectorReleaseMetadata = {
		version,
		sha256,
		size: zipBuffer.length,
		uploadedAt: new Date().toISOString(),
		uploadedBy: uploadedBy ?? 'build-script',
		objectKey: zipObjectKey,
		notes
	};

	try {
		// 1) ZIP artifact
		await client.putObject(bucket, zipObjectKey, zipBuffer, zipBuffer.length, {
			'Content-Type': 'application/zip',
			'X-Ots-Connector-Version': version,
			'X-Ots-Connector-Sha256': sha256
		});

		// 1b) Read-after-write verification. A MinIO disk error during the
		// PUT could surface as a successful response with corrupted bytes
		// persisted. We re-fetch and SHA-256 the result before rolling the
		// `latest.json` pointer — cheap for a 20 KB artifact, catastrophic
		// to skip (every site on the auto-update cron would pull a bad ZIP).
		const verifyStream = await client.getObject(bucket, zipObjectKey);
		const verifyChunks: Buffer[] = [];
		for await (const c of verifyStream) verifyChunks.push(c as Buffer);
		const verifyBuffer = Buffer.concat(verifyChunks);
		const verifySha = crypto.createHash('sha256').update(verifyBuffer).digest('hex');
		if (verifySha !== sha256) {
			throw new Error(
				`MinIO read-after-write mismatch for v${version}: expected ${sha256}, got ${verifySha}. ` +
					`Bucket=${bucket} key=${zipObjectKey}. latest.json NOT updated.`
			);
		}

		// 2) Per-version metadata
		const metaBuffer = Buffer.from(JSON.stringify(metadata, null, 2));
		await client.putObject(bucket, metaObjectKey, metaBuffer, metaBuffer.length, {
			'Content-Type': 'application/json'
		});

		// 3) Roll the pointer. We write this LAST so a partial upload
		//    never tricks clients into fetching a non-existent ZIP.
		await client.putObject(bucket, LATEST_POINTER, metaBuffer, metaBuffer.length, {
			'Content-Type': 'application/json',
			'Cache-Control': 'public, max-age=60' // clients can cache the pointer for 1 minute
		});

		logInfo('wordpress', `OTS Connector release published: v${version}`, {
			metadata: { version, sha256: sha256.slice(0, 12), size: zipBuffer.length, uploadedBy }
		});

		return metadata;
	} catch (err) {
		const { message, stack } = serializeError(err);
		logError('wordpress', `Failed to publish connector release v${version}: ${message}`, {
			metadata: { version, stackTrace: stack }
		});
		throw err;
	}
}

/**
 * Read the `latest.json` pointer. Returns null when no release has ever
 * been uploaded (fresh install) — callers should show an empty state
 * rather than erroring.
 */
export async function getLatestConnectorRelease(): Promise<ConnectorReleaseMetadata | null> {
	const client = getClient();
	const bucket = getBucketName();
	try {
		const stream = await client.getObject(bucket, LATEST_POINTER);
		const chunks: Buffer[] = [];
		for await (const chunk of stream) chunks.push(chunk as Buffer);
		const raw = Buffer.concat(chunks).toString('utf-8');
		return JSON.parse(raw) as ConnectorReleaseMetadata;
	} catch (err: unknown) {
		// MinIO returns NoSuchKey for missing pointers; treat that as a
		// "no releases yet" signal rather than an error.
		const code = (err as { code?: string; message?: string }).code;
		if (code === 'NoSuchKey' || code === 'NotFound') return null;
		const { message } = serializeError(err);
		logError('wordpress', `Failed to read latest connector pointer: ${message}`);
		throw err;
	}
}

/**
 * Stream a ZIP payload into memory and return it as a Buffer plus the
 * metadata. Used by the connector-update endpoint to fetch once and
 * forward the bytes to the target site via base64.
 */
export async function fetchConnectorRelease(
	version: string
): Promise<{ buffer: Buffer; metadata: ConnectorReleaseMetadata }> {
	const client = getClient();
	const bucket = getBucketName();

	// Prefer the per-version metadata.json so we can validate the SHA
	// against the ZIP we're about to fetch. Falls back to reconstructed
	// metadata if the JSON is missing (old uploads).
	let metadata: ConnectorReleaseMetadata;
	try {
		const metaStream = await client.getObject(bucket, `${CONNECTOR_PREFIX}/v${version}/metadata.json`);
		const chunks: Buffer[] = [];
		for await (const c of metaStream) chunks.push(c as Buffer);
		metadata = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as ConnectorReleaseMetadata;
	} catch {
		metadata = {
			version,
			sha256: '',
			size: 0,
			uploadedAt: new Date().toISOString(),
			objectKey: `${CONNECTOR_PREFIX}/v${version}/ots-wp-connector.zip`
		};
	}

	const zipStream = await client.getObject(bucket, metadata.objectKey);
	const zipChunks: Buffer[] = [];
	for await (const c of zipStream) zipChunks.push(c as Buffer);
	const buffer = Buffer.concat(zipChunks);

	// Verify checksum when we have one recorded.
	if (metadata.sha256) {
		const actual = crypto.createHash('sha256').update(buffer).digest('hex');
		if (actual !== metadata.sha256) {
			throw new Error(
				`Connector ZIP checksum mismatch for v${version}: expected ${metadata.sha256}, got ${actual}`
			);
		}
	}

	return { buffer, metadata };
}

/**
 * Compare two semantic-ish versions the same way WP does (matches the
 * one in the inspect endpoint). Returns -1, 0, 1.
 */
export function compareConnectorVersions(a: string, b: string): number {
	if (a === b) return 0;
	const norm = (v: string) =>
		v.toLowerCase().replace(/[-_+]/g, '.').replace(/([0-9])([a-z])/g, '$1.$2').replace(/([a-z])([0-9])/g, '$1.$2');
	const pa = norm(a).split('.').filter(Boolean);
	const pb = norm(b).split('.').filter(Boolean);
	const len = Math.max(pa.length, pb.length);
	for (let i = 0; i < len; i++) {
		const x = pa[i] ?? '0';
		const y = pb[i] ?? '0';
		if (x === y) continue;
		const nx = /^\d+$/.test(x) ? Number(x) : null;
		const ny = /^\d+$/.test(y) ? Number(y) : null;
		if (nx !== null && ny !== null) {
			if (nx !== ny) return nx < ny ? -1 : 1;
			continue;
		}
		return x < y ? -1 : 1;
	}
	return 0;
}

/**
 * Atomically record a successful connector update on a site.
 *
 * Problem: four separate call sites write `wordpress_site.connectorVersion`
 * after pushing a new release (manual endpoint, bulk endpoint, auto-update
 * cron, health sync). A bulk run and a manual update firing at the same
 * instant could both pass their individual version checks, both push
 * the same ZIP, and then both issue `UPDATE ... SET connectorVersion = ?`
 * — harmless when identical, but if one path briefly pinned a specific
 * older version the later write could overwrite a newer one.
 *
 * This helper does a read-compare-write that refuses to regress. It:
 *   1) SELECTs the current `connectorVersion` for the site
 *   2) Compares with the incoming version via `compareConnectorVersions`
 *   3) UPDATEs only if the incoming version is STRICTLY NEWER, and guards
 *      the UPDATE with `WHERE connectorVersion IS NOT DISTINCT FROM <snapshot>`
 *      to prevent a concurrent writer from inserting a newer value between
 *      the SELECT and the UPDATE.
 *
 * Returns `{ updated: true, currentVersion: newVersion }` when the row
 * was changed, `{ updated: false, currentVersion: <actual> }` when the
 * write was skipped (already current) or lost the optimistic race.
 * Callers can ignore the return value if they don't need the distinction.
 */
export async function updateConnectorVersionIfNewer(
	siteId: string,
	newVersion: string
): Promise<{ updated: boolean; currentVersion: string | null }> {
	const [row] = await db
		.select({ connectorVersion: table.wordpressSite.connectorVersion })
		.from(table.wordpressSite)
		.where(eq(table.wordpressSite.id, siteId))
		.limit(1);

	if (!row) {
		return { updated: false, currentVersion: null };
	}

	const snapshot = row.connectorVersion;

	// Fast-path: incoming version is not strictly newer → nothing to do.
	if (snapshot && compareConnectorVersions(newVersion, snapshot) <= 0) {
		return { updated: false, currentVersion: snapshot };
	}

	// Optimistic update — only succeed if `connectorVersion` is still
	// the value we just SELECTed. A concurrent writer that advances
	// the row will cause this UPDATE to affect 0 rows.
	//
	// SQL `=` never matches NULL (it returns UNKNOWN, not TRUE), so branch:
	// when the snapshot is NULL we must use `IS NULL`, otherwise `=`.
	const updateResult = await db
		.update(table.wordpressSite)
		.set({ connectorVersion: newVersion })
		.where(
			and(
				eq(table.wordpressSite.id, siteId),
				snapshot === null
					? isNull(table.wordpressSite.connectorVersion)
					: eq(table.wordpressSite.connectorVersion, snapshot)
			)
		)
		.returning({ id: table.wordpressSite.id });

	if (updateResult.length === 0) {
		// Optimistic lock lost — someone else just updated the row. Re-read
		// and return their value so the caller can decide what to do.
		const [fresh] = await db
			.select({ connectorVersion: table.wordpressSite.connectorVersion })
			.from(table.wordpressSite)
			.where(eq(table.wordpressSite.id, siteId))
			.limit(1);
		return { updated: false, currentVersion: fresh?.connectorVersion ?? null };
	}

	return { updated: true, currentVersion: newVersion };
}
