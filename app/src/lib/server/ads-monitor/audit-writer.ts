import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import type { ChangesJson } from './diff-builder';
import type { AdAuditAction, AdAuditActorType } from '$lib/server/db/schema';
import { db as _db } from '$lib/server/db';
import * as t from '$lib/server/db/schema';
import { and as _and, eq as _eq, desc as _desc, sql as _sql } from 'drizzle-orm';

export interface WriteAuditInput {
	tenantId: string;
	targetId: string;
	actorType: AdAuditActorType;
	actorId: string;
	action: AdAuditAction;
	changes?: ChangesJson;
	note?: string | null;
	metadata?: Record<string, unknown>;
}

/**
 * Insert one row into adMonitorTargetAudit. Skips if both `changes` is empty
 * AND `action` is 'updated' (i.e., a no-op patch). Always writes for non-update actions.
 */
export async function writeTargetAudit(input: WriteAuditInput): Promise<string | null> {
	const changes = input.changes ?? {};
	if (input.action === 'updated' && Object.keys(changes).length === 0) {
		return null; // skip no-op
	}
	const id = encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
	await db.insert(table.adMonitorTargetAudit).values({
		id,
		tenantId: input.tenantId,
		targetId: input.targetId,
		actorType: input.actorType,
		actorId: input.actorId,
		action: input.action,
		changesJson: JSON.stringify(changes),
		note: input.note?.trim().slice(0, 200) ?? null,
		metadataJson: JSON.stringify(input.metadata ?? {})
	});
	return id;
}

/**
 * Lazily auto-unsuppresses actions whose TTL has expired.
 * Called on GET target endpoints. Idempotent. No-op if nothing expired.
 * Returns the cleaned suppressedActions array (or original if no change).
 */
export async function evaluateAutoUnsuppress(
	tenantId: string,
	targetId: string,
	currentSuppressed: string[],
	currentVersion: number
): Promise<{ suppressedActions: string[]; version: number; changed: boolean }> {
	if (currentSuppressed.length === 0) {
		return { suppressedActions: currentSuppressed, version: currentVersion, changed: false };
	}
	// Find the auto-suppress audit row per action with metadata.expiresAt
	const auditRows = await _db
		.select({
			metadataJson: t.adMonitorTargetAudit.metadataJson,
			at: t.adMonitorTargetAudit.at
		})
		.from(t.adMonitorTargetAudit)
		.where(
			_and(
				_eq(t.adMonitorTargetAudit.targetId, targetId),
				_eq(t.adMonitorTargetAudit.actorType, 'worker')
			)
		)
		.orderBy(_desc(t.adMonitorTargetAudit.at));

	const expiredActions = new Set<string>();
	const now = Date.now();
	const seen = new Set<string>();
	for (const r of auditRows) {
		try {
			const meta = JSON.parse(r.metadataJson ?? '{}');
			const action = typeof meta.suppressedAction === 'string' ? meta.suppressedAction : null;
			const expiresIso = typeof meta.expiresAt === 'string' ? meta.expiresAt : null;
			if (!action || seen.has(action)) continue; // pick latest per action
			seen.add(action);
			if (expiresIso) {
				const exp = new Date(expiresIso).getTime();
				if (isFinite(exp) && now >= exp && currentSuppressed.includes(action)) {
					expiredActions.add(action);
				}
			}
		} catch {
			/* ignore */
		}
	}
	if (expiredActions.size === 0) {
		return { suppressedActions: currentSuppressed, version: currentVersion, changed: false };
	}
	const next = currentSuppressed.filter((a) => !expiredActions.has(a)).sort();
	const updated = await _db
		.update(t.adMonitorTarget)
		.set({
			suppressedActions: JSON.stringify(next),
			updatedAt: new Date(),
			version: _sql`${t.adMonitorTarget.version} + 1`
		})
		.where(
			_and(
				_eq(t.adMonitorTarget.id, targetId),
				_eq(t.adMonitorTarget.tenantId, tenantId),
				_eq(t.adMonitorTarget.version, currentVersion)
			)
		)
		.returning({ version: t.adMonitorTarget.version });
	if (updated.length === 0) {
		// Race lost — caller will see fresh state on retry; safe to return current
		return { suppressedActions: currentSuppressed, version: currentVersion, changed: false };
	}
	for (const action of expiredActions) {
		await writeTargetAudit({
			tenantId,
			targetId,
			actorType: 'system',
			actorId: 'auto-unsuppress',
			action: 'updated',
			changes: { suppressedActions: { from: currentSuppressed, to: next } },
			note: `Auto-unsuppress: TTL expirat pentru ${action}`
		});
	}
	return { suppressedActions: next, version: updated[0].version, changed: true };
}
