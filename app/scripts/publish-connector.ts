#!/usr/bin/env bun
/**
 * Publish a freshly-built OTS Connector ZIP to MinIO.
 *
 * Usage:
 *   bun scripts/publish-connector.ts                       # uses ../ots-wp-connector-v<X.Y.Z>.zip
 *   bun scripts/publish-connector.ts /path/to/custom.zip
 *   bun scripts/publish-connector.ts "" "0.6.4: bugfix blah"   # with changelog note
 *
 * Reads Version: from the plugin header to label the release, computes
 * SHA-256, uploads to the `ots-connector/releases/v<version>/` prefix,
 * and rolls `ots-connector/latest.json` forward.
 *
 * Self-contained: deliberately does NOT import from `$lib/...` because
 * that alias doesn't resolve outside SvelteKit's build pipeline. Talks
 * directly to MinIO via the `minio` SDK + process.env.
 *
 * Idempotent: re-uploading the same version overwrites both artifacts.
 */
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { Client as MinioClient } from 'minio';

const __dirname = dirname(fileURLToPath(import.meta.url));

const CONNECTOR_PREFIX = 'ots-connector/releases';
const LATEST_POINTER = 'ots-connector/latest.json';

interface ConnectorReleaseMetadata {
	version: string;
	sha256: string;
	size: number;
	uploadedAt: string;
	uploadedBy?: string;
	objectKey: string;
	notes?: string;
}

function requireEnv(key: string): string {
	const v = process.env[key];
	if (!v) {
		console.error(`ERROR: environment variable ${key} is required.`);
		console.error('Hint: run from app/ directory so bun picks up .env');
		process.exit(1);
	}
	return v;
}

function parseVersionFromPhp(phpSource: string): string | null {
	// Matches WP's own `get_file_data()` regex on the "Version:" header.
	const match = phpSource.match(/^[ \t*/#@]*Version:\s*(.+)$/m);
	return match ? match[1].trim() : null;
}

async function main() {
	const explicitZip = process.argv[2];
	const notes = process.argv[3] || undefined;

	const repoRoot = resolve(__dirname, '../..'); // .../CRM
	const pluginDir = resolve(repoRoot, 'ots-wp-connector');
	const phpPath = resolve(pluginDir, 'ots-connector.php');

	if (!existsSync(phpPath)) {
		console.error(`ERROR: Could not find ${phpPath}`);
		process.exit(1);
	}

	const phpSource = await readFile(phpPath, 'utf-8');
	const version = parseVersionFromPhp(phpSource);
	if (!version) {
		console.error('ERROR: could not parse Version: header from ots-connector.php');
		process.exit(1);
	}

	const zipPath =
		explicitZip && explicitZip !== ''
			? resolve(explicitZip)
			: resolve(repoRoot, `ots-wp-connector-v${version}.zip`);

	if (!existsSync(zipPath)) {
		console.error(`ERROR: ZIP not found at ${zipPath}`);
		console.error('Hint: run ots-wp-connector/build.sh first (or `bun run connector:build`)');
		process.exit(1);
	}

	const zipBuffer = await readFile(zipPath);
	const sha256 = crypto.createHash('sha256').update(zipBuffer).digest('hex');

	// MinIO client — same settings as the server-side release helper.
	const endpoint = requireEnv('MINIO_ENDPOINT');
	const port = parseInt(process.env.MINIO_PORT || '9000');
	const useSSL = process.env.MINIO_USE_SSL === 'true';
	const accessKey = requireEnv('MINIO_ACCESS_KEY');
	const secretKey = requireEnv('MINIO_SECRET_KEY');
	// Required — no silent fallback. Publishing to the wrong bucket is a
	// "looks fine, nothing breaks, but nobody can fetch the release" bug.
	const bucket = requireEnv('MINIO_BUCKET_NAME');

	const client = new MinioClient({ endPoint: endpoint, port, useSSL, accessKey, secretKey });

	const zipObjectKey = `${CONNECTOR_PREFIX}/v${version}/ots-wp-connector.zip`;
	const metaObjectKey = `${CONNECTOR_PREFIX}/v${version}/metadata.json`;

	const metadata: ConnectorReleaseMetadata = {
		version,
		sha256,
		size: zipBuffer.length,
		uploadedAt: new Date().toISOString(),
		uploadedBy: 'publish-connector.ts',
		objectKey: zipObjectKey,
		notes
	};

	console.log(`Publishing OTS Connector v${version}`);
	console.log(`  ZIP:       ${zipPath}`);
	console.log(`  Size:      ${(zipBuffer.length / 1024).toFixed(1)} KB`);
	console.log(`  SHA-256:   ${sha256}`);
	console.log(`  Bucket:    ${bucket}`);
	console.log(`  Endpoint:  ${useSSL ? 'https' : 'http'}://${endpoint}:${port}`);
	if (notes) console.log(`  Notes:     ${notes}`);

	// 1) ZIP artifact
	await client.putObject(bucket, zipObjectKey, zipBuffer, zipBuffer.length, {
		'Content-Type': 'application/zip',
		'X-Ots-Connector-Version': version,
		'X-Ots-Connector-Sha256': sha256
	});
	console.log(`  ✓ Uploaded ${zipObjectKey}`);

	// 2) Per-version metadata
	const metaBuffer = Buffer.from(JSON.stringify(metadata, null, 2));
	await client.putObject(bucket, metaObjectKey, metaBuffer, metaBuffer.length, {
		'Content-Type': 'application/json'
	});
	console.log(`  ✓ Uploaded ${metaObjectKey}`);

	// 3) Roll the pointer — written LAST so a partial upload never tricks
	//    clients into fetching a non-existent ZIP.
	await client.putObject(bucket, LATEST_POINTER, metaBuffer, metaBuffer.length, {
		'Content-Type': 'application/json',
		'Cache-Control': 'public, max-age=60'
	});
	console.log(`  ✓ Rolled latest.json → v${version}`);

	console.log('\n✓ Release published.');
}

main().catch((err) => {
	console.error('Publish failed:', err);
	process.exit(1);
});
