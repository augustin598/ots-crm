/**
 * Seed default WHMCS import credentials into tenantPlugin.config.whmcsImport
 * for every tenant that has the `directadmin` plugin enabled.
 *
 * Idempotent: re-running just overwrites the same row with freshly-encrypted
 * password. Safe to run repeatedly.
 *
 * Usage:
 *   bun run scripts/seed-whmcs-import-defaults.ts
 */

import 'dotenv/config';
import { drizzle } from 'drizzle-orm/libsql';
import { createClient } from '@libsql/client';
import * as schema from '../src/lib/server/db/schema.ts';
import { eq, and } from 'drizzle-orm';
import { createCipheriv, randomBytes, pbkdf2Sync } from 'crypto';

if (!process.env.SQLITE_URI || !process.env.SQLITE_AUTH_TOKEN) {
	throw new Error('SQLITE_URI / SQLITE_AUTH_TOKEN not set');
}
if (!process.env.ENCRYPTION_SECRET) {
	throw new Error('ENCRYPTION_SECRET not set');
}

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_LENGTH = 32;
const KEY_LENGTH = 32;
const ITERATIONS = 100000;

function encrypt(tenantId: string, plaintext: string): string {
	const secret = process.env.ENCRYPTION_SECRET!;
	const salt = randomBytes(SALT_LENGTH);
	const key = pbkdf2Sync(secret + tenantId, salt, ITERATIONS, KEY_LENGTH, 'sha256');
	const iv = randomBytes(IV_LENGTH);
	const cipher = createCipheriv(ALGORITHM, key, iv);
	const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
	const authTag = cipher.getAuthTag();
	return Buffer.concat([salt, iv, authTag, encrypted]).toString('base64');
}

const DEFAULTS = {
	host: '127.0.0.1',
	port: 13306,
	user: 'onetopsolution_6',
	password: 'tp4S[l)D19',
	database: 'onetopsolution_6'
};

async function main() {
	const client = createClient({
		url: process.env.SQLITE_URI!,
		authToken: process.env.SQLITE_AUTH_TOKEN!
	});
	const db = drizzle(client, { schema });

	const pluginRow = await db
		.select({ id: schema.plugin.id, name: schema.plugin.name })
		.from(schema.plugin)
		.where(eq(schema.plugin.name, 'directadmin'))
		.limit(1);

	if (pluginRow.length === 0) {
		console.error('directadmin plugin row not found in `plugin` table.');
		process.exit(1);
	}
	const pluginId = pluginRow[0].id;
	console.log(`[seed] directadmin plugin id: ${pluginId}`);

	const tenantRows = await db
		.select({
			id: schema.tenantPlugin.id,
			tenantId: schema.tenantPlugin.tenantId,
			config: schema.tenantPlugin.config
		})
		.from(schema.tenantPlugin)
		.where(
			and(eq(schema.tenantPlugin.pluginId, pluginId), eq(schema.tenantPlugin.isActive, true))
		);

	if (tenantRows.length === 0) {
		console.warn('[seed] no tenants have directadmin enabled. Nothing to do.');
		return;
	}

	for (const row of tenantRows) {
		const passwordEncrypted = encrypt(row.tenantId, DEFAULTS.password);
		const existing = (row.config ?? {}) as Record<string, unknown>;
		const next: Record<string, unknown> = {
			...existing,
			whmcsImport: {
				host: DEFAULTS.host,
				port: DEFAULTS.port,
				user: DEFAULTS.user,
				database: DEFAULTS.database,
				passwordEncrypted
			}
		};
		await db
			.update(schema.tenantPlugin)
			.set({ config: next, updatedAt: new Date() })
			.where(eq(schema.tenantPlugin.id, row.id));
		console.log(`[seed] tenant ${row.tenantId}: defaults written.`);
	}

	console.log(`[seed] done. ${tenantRows.length} tenant(s) updated.`);
}

main().catch((e) => {
	console.error('[seed] failed:', e);
	process.exit(1);
});
