import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import type { ChangesJson } from './diff-builder';
import type { AdAuditAction, AdAuditActorType } from '$lib/server/db/schema';

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
