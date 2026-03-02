import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { encodeBase32LowerCase } from '@oslojs/encoding';

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
