import { json, error } from '@sveltejs/kit';
import { and, asc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { logError, serializeError } from '$lib/server/logger';
import type { RequestHandler } from './$types';

const MAX_PINS = 8;

async function loadPins(userId: string, tenantId: string) {
	return db
		.select({ itemId: table.userSidebarPin.itemId, position: table.userSidebarPin.position })
		.from(table.userSidebarPin)
		.where(
			and(eq(table.userSidebarPin.userId, userId), eq(table.userSidebarPin.tenantId, tenantId))
		)
		.orderBy(asc(table.userSidebarPin.position), asc(table.userSidebarPin.createdAt));
}

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user || !locals.tenant) throw error(401, 'Unauthorized');
	if (!locals.tenantUser) throw error(403, 'Forbidden');

	const rows = await loadPins(locals.user.id, locals.tenant.id);
	return json({ items: rows.map((r) => r.itemId) });
};

// POST { itemId: string } — toggle. Returns updated list.
export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user || !locals.tenant) throw error(401, 'Unauthorized');
	if (!locals.tenantUser) throw error(403, 'Forbidden');

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON');
	}
	const itemId =
		body && typeof body === 'object' && 'itemId' in body
			? String((body as { itemId: unknown }).itemId)
			: '';
	if (!itemId || itemId.length > 64) throw error(400, 'Invalid itemId');

	try {
		const userId = locals.user.id;
		const tenantId = locals.tenant.id;
		const existing = await db
			.select()
			.from(table.userSidebarPin)
			.where(
				and(
					eq(table.userSidebarPin.userId, userId),
					eq(table.userSidebarPin.tenantId, tenantId),
					eq(table.userSidebarPin.itemId, itemId)
				)
			)
			.limit(1);

		if (existing.length > 0) {
			await db.delete(table.userSidebarPin).where(eq(table.userSidebarPin.id, existing[0].id));
		} else {
			const current = await loadPins(userId, tenantId);
			if (current.length >= MAX_PINS) throw error(400, `Maxim ${MAX_PINS} favorite`);
			await db.insert(table.userSidebarPin).values({
				id: randomUUID(),
				userId,
				tenantId,
				itemId,
				position: current.length
			});
		}

		const refreshed = await loadPins(userId, tenantId);
		return json({ items: refreshed.map((r) => r.itemId) });
	} catch (e) {
		if (e && typeof e === 'object' && 'status' in e) throw e;
		logError('server', 'sidebar-pins toggle failed', { ...serializeError(e), userId: locals.user.id });
		throw error(500, 'Database error');
	}
};

// PUT { items: string[] } — reorder. Items NOT in payload are removed.
export const PUT: RequestHandler = async ({ locals, request }) => {
	if (!locals.user || !locals.tenant) throw error(401, 'Unauthorized');
	if (!locals.tenantUser) throw error(403, 'Forbidden');

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON');
	}
	const items =
		body && typeof body === 'object' && 'items' in body
			? (body as { items: unknown }).items
			: null;
	if (!Array.isArray(items)) throw error(400, 'items must be array');
	if (items.length > MAX_PINS) throw error(400, `Maxim ${MAX_PINS} favorite`);
	const cleaned: string[] = [];
	for (const v of items) {
		if (typeof v !== 'string' || v.length === 0 || v.length > 64) continue;
		if (!cleaned.includes(v)) cleaned.push(v);
	}

	try {
		const userId = locals.user.id;
		const tenantId = locals.tenant.id;
		await db
			.delete(table.userSidebarPin)
			.where(
				and(eq(table.userSidebarPin.userId, userId), eq(table.userSidebarPin.tenantId, tenantId))
			);
		if (cleaned.length > 0) {
			await db.insert(table.userSidebarPin).values(
				cleaned.map((itemId, idx) => ({
					id: randomUUID(),
					userId,
					tenantId,
					itemId,
					position: idx
				}))
			);
		}
		return json({ items: cleaned });
	} catch (e) {
		if (e && typeof e === 'object' && 'status' in e) throw e;
		logError('server', 'sidebar-pins reorder failed', { ...serializeError(e), userId: locals.user.id });
		throw error(500, 'Database error');
	}
};
