/**
 * Seed function — mirrors CAPABILITY_CATALOG into the access_capability DB
 * table for audit/admin UIs. Idempotent: upsert by id.
 *
 * Called once at app boot from hooks.server.ts after runMigrations().
 */

import { db } from './db';
import { accessCapability } from './db/schema';
import { eq, inArray, notInArray } from 'drizzle-orm';
import { CAPABILITY_CATALOG } from '$lib/access/catalog';

let seeded = false;

export async function seedAccessCatalog(): Promise<void> {
	if (seeded) return;
	try {
		const catalogIds = CAPABILITY_CATALOG.map((c) => c.id);

		// Read current rows
		const existing = await db
			.select({ id: accessCapability.id })
			.from(accessCapability);
		const existingIds = new Set(existing.map((r) => r.id));

		// Upsert each catalog entry
		for (const cap of CAPABILITY_CATALOG) {
			if (existingIds.has(cap.id)) {
				await db
					.update(accessCapability)
					.set({
						domain: cap.domain,
						groupLabel: cap.groupLabel,
						label: cap.label,
						description: cap.description ?? null,
						unsafeUnlessRole: cap.unsafeUnlessRole ?? null
					})
					.where(eq(accessCapability.id, cap.id));
			} else {
				await db.insert(accessCapability).values({
					id: cap.id,
					domain: cap.domain,
					groupLabel: cap.groupLabel,
					label: cap.label,
					description: cap.description ?? null,
					unsafeUnlessRole: cap.unsafeUnlessRole ?? null
				});
			}
		}

		// Remove rows for capabilities no longer in catalog
		if (catalogIds.length > 0) {
			await db
				.delete(accessCapability)
				.where(notInArray(accessCapability.id, catalogIds));
		}

		console.log(`[ACCESS] Catalog seeded (${CAPABILITY_CATALOG.length} capabilities)`);
		seeded = true;
	} catch (e) {
		// Don't crash the app if seed fails — engine reads from TS directly.
		console.error(
			'[ACCESS] Seed failed (non-fatal, engine still works):',
			e instanceof Error ? e.message : e
		);
	}
}
