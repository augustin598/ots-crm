import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { AD_RECOMMENDATION_ACTIONS } from '$lib/server/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { withApiKey } from '$lib/server/api-keys/middleware';
import { writeTargetAudit } from '$lib/server/ads-monitor/audit-writer';
import { logInfo } from '$lib/server/logger';

const TTL_DAYS = 30;
const VALID_ACTIONS = new Set<string>(AD_RECOMMENDATION_ACTIONS);

export const POST: RequestHandler = (event) =>
	withApiKey(event, 'ads_monitor:write', async (event, ctx) => {
		const id = event.params.id;
		if (!id) {
			return { status: 400, body: { error: 'missing_id' } };
		}

		let body: Record<string, unknown>;
		try {
			body = (await event.request.json()) as Record<string, unknown>;
		} catch {
			return { status: 400, body: { error: 'invalid_json' } };
		}

		const action = typeof body.action === 'string' ? body.action : null;
		const expectedVersion = typeof body.expectedVersion === 'number' ? body.expectedVersion : null;
		const reason = typeof body.reason === 'string' ? body.reason.slice(0, 200) : null;

		if (!action || !VALID_ACTIONS.has(action)) {
			return { status: 400, body: { error: 'invalid_action' } };
		}
		if (expectedVersion === null) {
			return { status: 400, body: { error: 'missing_expected_version' } };
		}

		const [target] = await db
			.select()
			.from(table.adMonitorTarget)
			.where(
				and(
					eq(table.adMonitorTarget.id, id),
					eq(table.adMonitorTarget.tenantId, ctx.tenantId)
				)
			)
			.limit(1);
		if (!target) {
			return { status: 404, body: { error: 'not_found' } };
		}

		if (target.version !== expectedVersion) {
			return {
				status: 409,
				body: { ok: false, error: 'version_conflict', currentVersion: target.version }
			};
		}

		let current: string[] = [];
		try {
			const parsed = JSON.parse(target.suppressedActions ?? '[]');
			if (Array.isArray(parsed)) {
				current = parsed.filter((x): x is string => typeof x === 'string');
			}
		} catch {
			current = [];
		}

		if (current.includes(action)) {
			return {
				status: 200,
				body: { ok: true, alreadySuppressed: true, version: target.version }
			};
		}

		const next = [...current, action].sort();
		const updated = await db
			.update(table.adMonitorTarget)
			.set({
				suppressedActions: JSON.stringify(next),
				updatedAt: new Date(),
				version: sql`${table.adMonitorTarget.version} + 1`
			})
			.where(
				and(
					eq(table.adMonitorTarget.id, id),
					eq(table.adMonitorTarget.tenantId, ctx.tenantId),
					eq(table.adMonitorTarget.version, target.version)
				)
			)
			.returning({ version: table.adMonitorTarget.version });

		if (updated.length === 0) {
			const [fresh] = await db
				.select({ version: table.adMonitorTarget.version })
				.from(table.adMonitorTarget)
				.where(eq(table.adMonitorTarget.id, id))
				.limit(1);
			return {
				status: 409,
				body: { ok: false, error: 'version_conflict', currentVersion: fresh?.version ?? null }
			};
		}

		const expiresAt = new Date(Date.now() + TTL_DAYS * 86400_000);
		await writeTargetAudit({
			tenantId: ctx.tenantId,
			targetId: id,
			actorType: 'worker',
			actorId: 'ads_optimizer',
			action: 'updated',
			changes: { suppressedActions: { from: current, to: next } },
			note: `Auto-suppress: ${reason ?? 'rate threshold exceeded'} — expiră în ${TTL_DAYS} zile`,
			metadata: { expiresAt: expiresAt.toISOString(), suppressedAction: action }
		});

		logInfo('ads-monitor', `Auto-suppress applied: target=${id} action=${action}`, {
			tenantId: ctx.tenantId,
			metadata: { reason, expiresAt: expiresAt.toISOString() }
		});

		return {
			status: 200,
			body: { ok: true, version: updated[0].version, expiresAt: expiresAt.toISOString() }
		};
	});
