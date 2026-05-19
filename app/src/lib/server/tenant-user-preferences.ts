import { db } from './db';
import * as table from './db/schema';
import { eq, and, inArray } from 'drizzle-orm';

export type TenantUserNotifyKey =
	| 'notifyTaskAssigned'
	| 'notifyNewComment'
	| 'notifyTaskStatusChange'
	| 'notifyTaskApprovedRejected'
	| 'notifyTaskReopened'
	| 'notifyMention';

export async function tenantUserPrefAllows(
	userId: string,
	tenantId: string,
	key: TenantUserNotifyKey
): Promise<boolean> {
	const [row] = await db
		.select({ value: table.tenantUserPreferences[key] })
		.from(table.tenantUserPreferences)
		.where(
			and(
				eq(table.tenantUserPreferences.userId, userId),
				eq(table.tenantUserPreferences.tenantId, tenantId)
			)
		)
		.limit(1);
	if (!row) return true;
	return row.value !== false;
}

export async function tenantUserPrefAllowsBatch(
	userIds: string[],
	tenantId: string,
	key: TenantUserNotifyKey
): Promise<Map<string, boolean>> {
	const allowed = new Map<string, boolean>();
	for (const id of userIds) allowed.set(id, true);
	if (userIds.length === 0) return allowed;

	const rows = await db
		.select({
			userId: table.tenantUserPreferences.userId,
			value: table.tenantUserPreferences[key]
		})
		.from(table.tenantUserPreferences)
		.where(
			and(
				inArray(table.tenantUserPreferences.userId, userIds),
				eq(table.tenantUserPreferences.tenantId, tenantId)
			)
		);
	for (const r of rows) allowed.set(r.userId, r.value !== false);
	return allowed;
}
