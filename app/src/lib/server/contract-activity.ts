import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { encodeBase32LowerCase } from '@oslojs/encoding';

export async function recordContractActivity(params: {
	contractId: string;
	userId: string | null;
	tenantId: string;
	action: string;
	field?: string;
	oldValue?: string | null;
	newValue?: string | null;
}) {
	const id = encodeBase32LowerCase(crypto.getRandomValues(new Uint8Array(15)));
	await db.insert(table.contractActivity).values({
		id,
		contractId: params.contractId,
		userId: params.userId,
		tenantId: params.tenantId,
		action: params.action,
		field: params.field ?? null,
		oldValue: params.oldValue ?? null,
		newValue: params.newValue ?? null,
		createdAt: new Date()
	});
}
