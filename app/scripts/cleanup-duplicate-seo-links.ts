/**
 * Cleanup duplicate seoLink records.
 *
 * A duplicate = same (tenantId, clientId, normalizedArticleUrl).
 * For each duplicate group, keeps the row with the oldest createdAt and
 * deletes the rest. seoLinkCheck has onDelete cascade so those are cleaned
 * automatically.
 *
 * Usage:
 *   bun run scripts/cleanup-duplicate-seo-links.ts --dry-run
 *   bun run scripts/cleanup-duplicate-seo-links.ts
 */

import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { inArray } from 'drizzle-orm';
import * as schema from '../src/lib/server/db/schema';

// Load .env manually since we're outside the SvelteKit Vite context
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
	const envPath = join(__dirname, '..', '.env');
	try {
		const content = readFileSync(envPath, 'utf-8');
		for (const line of content.split('\n')) {
			const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
			if (m) {
				const [, key, rawVal] = m;
				const val = rawVal.replace(/^['"]|['"]$/g, '');
				if (!process.env[key]) process.env[key] = val;
			}
		}
	} catch {
		// .env not present → rely on real env vars
	}
}
loadEnv();

const sqlitePath = process.env.SQLITE_PATH;
const tursoUrl = process.env.SQLITE_URI;
const tursoAuthToken = process.env.SQLITE_AUTH_TOKEN;

let client;
if (sqlitePath) {
	client = createClient({ url: `file:${sqlitePath}` });
} else if (tursoUrl) {
	client = createClient({ url: tursoUrl, authToken: tursoAuthToken });
} else {
	console.error('[cleanup] Neither SQLITE_PATH nor SQLITE_URI is set');
	process.exit(1);
}

const db = drizzle(client, { schema });

function normalizeUrl(raw: string): string {
	try {
		const u = new URL(raw);
		u.hostname = u.hostname.toLowerCase();
		const keysToDelete: string[] = [];
		for (const [key] of u.searchParams) {
			if (/^utm_/i.test(key) || ['fbclid', 'gclid', 'mc_cid'].includes(key)) {
				keysToDelete.push(key);
			}
		}
		for (const key of keysToDelete) u.searchParams.delete(key);
		let normalized = u.toString();
		if (u.pathname !== '/' && normalized.endsWith('/')) {
			normalized = normalized.slice(0, -1);
		}
		return normalized;
	} catch {
		return raw;
	}
}

async function main() {
	try {
		const allLinks = await db.select().from(schema.seoLink);
		console.log(`[cleanup] Loaded ${allLinks.length} seoLinks`);

		const groupMap = new Map<string, typeof allLinks>();
		for (const link of allLinks) {
			if (!link.articleUrl) continue;
			const normalized = normalizeUrl(link.articleUrl);
			const groupKey = `${link.tenantId}|${link.clientId}|${normalized}`;
			if (!groupMap.has(groupKey)) groupMap.set(groupKey, []);
			groupMap.get(groupKey)!.push(link);
		}

		const duplicateGroups = Array.from(groupMap.entries())
			.filter(([, links]) => links.length > 1)
			.map(([key, links]) => ({
				key,
				links: links.slice().sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
			}));

		const totalDuplicatesToDelete = duplicateGroups.reduce(
			(sum, group) => sum + (group.links.length - 1),
			0
		);

		console.log(
			`[cleanup] Found ${duplicateGroups.length} duplicate groups with ${totalDuplicatesToDelete} total duplicates to delete`
		);

		const isDryRun = process.argv.includes('--dry-run');

		if (isDryRun) {
			console.log('[cleanup] DRY RUN - not deleting');
			for (const group of duplicateGroups) {
				const keep = group.links[0];
				const deleteIds = group.links.slice(1).map((l) => l.id);
				console.log(
					`  group: ${group.key} | keep: ${keep.id} | delete: [${deleteIds.join(', ')}]`
				);
			}
		} else {
			const idsToDelete: string[] = [];
			for (const group of duplicateGroups) {
				idsToDelete.push(...group.links.slice(1).map((l) => l.id));
			}
			// seoLinkCheck has onDelete: 'cascade' → cascades automatically
			for (let i = 0; i < idsToDelete.length; i += 100) {
				const chunk = idsToDelete.slice(i, i + 100);
				await db.delete(schema.seoLink).where(inArray(schema.seoLink.id, chunk));
			}
			console.log(
				`[cleanup] Deleted ${totalDuplicatesToDelete} records. Kept ${duplicateGroups.length} originals.`
			);
		}

		process.exit(0);
	} catch (err) {
		console.error('[cleanup] failed:', err);
		process.exit(1);
	}
}

main();
