import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { encodeBase32LowerCase } from '@oslojs/encoding';

/**
 * Known task activity action types. The `action` field in `recordTaskActivity`
 * accepts any string for forward-compat, but callers should use these constants.
 */
export type TaskActivityAction =
	// Generic field edits
	| 'field_updated'
	| 'status_changed'
	| 'assignee_added'
	| 'assignee_removed'
	| 'tag_added'
	| 'tag_removed'
	| 'comment_added'
	| 'created'
	| 'deleted'
	| 'subtask_added'
	| 'subtask_removed'
	// Google Meet / Calendar lifecycle
	| 'meet_event_created'
	| 'meet_event_updated'
	| 'meet_event_deleted'
	| 'meet_event_failed'
	| 'meet_event_orphaned';

export async function recordTaskActivity(params: {
	taskId: string;
	userId: string;
	tenantId: string;
	action: string;
	field?: string;
	oldValue?: string | null;
	newValue?: string | null;
}) {
	const id = encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
	await db.insert(table.taskActivity).values({
		id,
		taskId: params.taskId,
		userId: params.userId,
		tenantId: params.tenantId,
		action: params.action,
		field: params.field ?? null,
		oldValue: params.oldValue ?? null,
		newValue: params.newValue ?? null,
		createdAt: new Date()
	});
}
