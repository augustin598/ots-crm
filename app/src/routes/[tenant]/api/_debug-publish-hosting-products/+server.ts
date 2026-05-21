/**
 * One-shot helper to mark all currently-active hosting products as public,
 * so they appear on the marketing page `/pachete-hosting`.
 *
 *   POST /[tenant]/api/_debug-publish-hosting-products            (dry-run; default)
 *   POST /[tenant]/api/_debug-publish-hosting-products?apply=true (mutate)
 *
 * Operates only on rows with isActive=true AND isPublic=false for the caller's
 * tenant. Also assigns publicSortOrder when null/0 — copies the internal
 * sortOrder so the public page mirrors the admin ordering by default. Admin-only.
 */

import { json, error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { and, eq } from 'drizzle-orm';
import { logInfo } from '$lib/server/logger';
import { withTursoBusyRetry } from '$lib/server/plugins/keez/db-retry';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	if (!event.locals.user || !event.locals.tenant) throw error(401, 'Unauthorized');
	const role = event.locals.tenantUser?.role;
	if (role !== 'owner' && role !== 'admin') {
		throw error(403, 'Forbidden: Admin access required');
	}
	const tenantId = event.locals.tenant.id;
	const apply = event.url.searchParams.get('apply') === 'true';
	logInfo('directadmin', `debug-publish-hosting-products called (apply=${apply})`, {
		tenantId,
		action: 'debug_publish_hosting_products',
		userId: event.locals.user.id,
		metadata: { apply, ip: event.getClientAddress?.() ?? null }
	});

	const candidates = await db
		.select({
			id: table.hostingProduct.id,
			name: table.hostingProduct.name,
			isActive: table.hostingProduct.isActive,
			isPublic: table.hostingProduct.isPublic,
			sortOrder: table.hostingProduct.sortOrder,
			publicSortOrder: table.hostingProduct.publicSortOrder
		})
		.from(table.hostingProduct)
		.where(
			and(
				eq(table.hostingProduct.tenantId, tenantId),
				eq(table.hostingProduct.isActive, true)
			)
		);

	const toPublish = candidates.filter((p) => !p.isPublic);
	const alreadyPublic = candidates.filter((p) => p.isPublic);

	if (apply && toPublish.length > 0) {
		// Wrap each UPDATE in withTursoBusyRetry — Turso can briefly write-lock on
		// concurrent writes and the loop would otherwise stop mid-tenant on the
		// first busy hit, leaving a partial publish state (Audit LOW-2).
		for (const p of toPublish) {
			const newPublicSort = p.publicSortOrder > 0 ? p.publicSortOrder : p.sortOrder;
			await withTursoBusyRetry(
				() =>
					db
						.update(table.hostingProduct)
						.set({ isPublic: true, publicSortOrder: newPublicSort, updatedAt: new Date() })
						.where(
							and(
								eq(table.hostingProduct.id, p.id),
								eq(table.hostingProduct.tenantId, tenantId)
							)
						),
				{ tenantId, label: 'debug-publish-hosting-products' }
			);
		}
	}

	logInfo(
		'directadmin',
		`Publish hosting products (apply=${apply}): ${toPublish.length} to publish, ${alreadyPublic.length} already public`,
		{ tenantId, action: 'publish_hosting_products' }
	);

	return json({
		ok: true,
		apply,
		tenantId,
		candidates: candidates.length,
		alreadyPublicCount: alreadyPublic.length,
		toPublishCount: toPublish.length,
		toPublish: toPublish.map((p) => ({
			id: p.id,
			name: p.name,
			currentSortOrder: p.sortOrder,
			willSetPublicSortOrder: p.publicSortOrder > 0 ? p.publicSortOrder : p.sortOrder
		}))
	});
};
