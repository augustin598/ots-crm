import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { withApiKey } from '$lib/server/api-keys/middleware';

function generateId(): string {
	return encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
}

/**
 * POST /api/external/heartbeat
 * Auth: X-API-Key
 * Body: { instanceId: string, version?: string, metadata?: object }
 *
 * UPSERT a personalops_instance row. Called every 5 min by PersonalOPS daemon.
 */
export const POST: RequestHandler = (event) =>
	withApiKey(event, 'ads_monitor:write', async (event, ctx) => {
		let body: Record<string, unknown>;
		try {
			body = (await event.request.json()) as Record<string, unknown>;
		} catch {
			return { status: 400, body: { error: 'invalid_json' } };
		}

		const instanceId = typeof body.instanceId === 'string' ? body.instanceId.trim() : null;
		if (!instanceId) {
			return { status: 400, body: { error: 'missing_instance_id' } };
		}

		const version = typeof body.version === 'string' ? body.version : null;
		const metadata =
			body.metadata && typeof body.metadata === 'object'
				? JSON.stringify(body.metadata)
				: null;

		const now = new Date();

		const [existing] = await db
			.select({ id: table.personalopsInstance.id })
			.from(table.personalopsInstance)
			.where(eq(table.personalopsInstance.instanceId, instanceId))
			.limit(1);

		if (existing) {
			await db
				.update(table.personalopsInstance)
				.set({ lastHeartbeatAt: now, version, metadata, updatedAt: now })
				.where(eq(table.personalopsInstance.id, existing.id));
		} else {
			await db.insert(table.personalopsInstance).values({
				id: generateId(),
				tenantId: ctx.tenantId,
				instanceId,
				lastHeartbeatAt: now,
				version,
				metadata,
				createdAt: now,
				updatedAt: now
			});
		}

		return { status: 200, body: { ok: true, server_time: now.toISOString() } };
	});
