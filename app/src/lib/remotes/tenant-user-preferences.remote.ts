import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';
import { requireStaff } from '$lib/server/get-actor';

function generateId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

const DEFAULTS = {
	notifyTaskAssigned: true,
	notifyNewComment: true,
	notifyTaskStatusChange: true,
	notifyTaskApprovedRejected: true,
	notifyTaskReopened: true,
	notifyMention: true
};

export const getTenantUserPreferences = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || event?.locals.isClientUser || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}
	await requireStaff(event);
	const userId = event.locals.user.id;
	const tenantId = event.locals.tenant.id;

	const [prefs] = await db
		.select()
		.from(table.tenantUserPreferences)
		.where(
			and(
				eq(table.tenantUserPreferences.userId, userId),
				eq(table.tenantUserPreferences.tenantId, tenantId)
			)
		)
		.limit(1);

	if (!prefs) return { ...DEFAULTS };
	return {
		notifyTaskAssigned: prefs.notifyTaskAssigned ?? DEFAULTS.notifyTaskAssigned,
		notifyNewComment: prefs.notifyNewComment ?? DEFAULTS.notifyNewComment,
		notifyTaskStatusChange: prefs.notifyTaskStatusChange ?? DEFAULTS.notifyTaskStatusChange,
		notifyTaskApprovedRejected:
			prefs.notifyTaskApprovedRejected ?? DEFAULTS.notifyTaskApprovedRejected,
		notifyTaskReopened: prefs.notifyTaskReopened ?? DEFAULTS.notifyTaskReopened,
		notifyMention: prefs.notifyMention ?? DEFAULTS.notifyMention
	};
});

const updateSchema = v.object({
	notifyTaskAssigned: v.optional(v.boolean()),
	notifyNewComment: v.optional(v.boolean()),
	notifyTaskStatusChange: v.optional(v.boolean()),
	notifyTaskApprovedRejected: v.optional(v.boolean()),
	notifyTaskReopened: v.optional(v.boolean()),
	notifyMention: v.optional(v.boolean())
});

export const updateTenantUserPreferences = command(updateSchema, async (data) => {
	const event = getRequestEvent();
	if (!event?.locals.user || event?.locals.isClientUser || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}
	await requireStaff(event);
	const userId = event.locals.user.id;
	const tenantId = event.locals.tenant.id;

	const [existing] = await db
		.select()
		.from(table.tenantUserPreferences)
		.where(
			and(
				eq(table.tenantUserPreferences.userId, userId),
				eq(table.tenantUserPreferences.tenantId, tenantId)
			)
		)
		.limit(1);

	if (existing) {
		await db
			.update(table.tenantUserPreferences)
			.set({ ...data, updatedAt: new Date() })
			.where(
				and(
					eq(table.tenantUserPreferences.userId, userId),
					eq(table.tenantUserPreferences.tenantId, tenantId)
				)
			);
	} else {
		await db.insert(table.tenantUserPreferences).values({
			id: generateId(),
			userId,
			tenantId,
			...data
		});
	}

	return { success: true };
});
