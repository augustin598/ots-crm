import { query, command, getRequestEvent } from '$app/server';
import { requireStaff } from '$lib/server/get-actor';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq, and } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';

function generateUserWorkHoursId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

export const getUserWorkHours = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}
		await requireStaff(event);

	const [workHours] = await db
		.select()
		.from(table.userWorkHours)
		.where(
			and(
				eq(table.userWorkHours.userId, event.locals.user.id),
				eq(table.userWorkHours.tenantId, event.locals.tenant.id)
			)
		)
		.limit(1);

	return workHours || null;
});

const updateUserWorkHoursSchema = v.object({
	workStartTime: v.optional(v.string()),
	workEndTime: v.optional(v.string()),
	workDays: v.optional(v.array(v.string())),
	remindersEnabled: v.optional(v.boolean())
});

export const updateUserWorkHours = command(updateUserWorkHoursSchema, async (data) => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}
		await requireStaff(event);

	// Check if work hours already exist
	const [existing] = await db
		.select()
		.from(table.userWorkHours)
		.where(
			and(
				eq(table.userWorkHours.userId, event.locals.user.id),
				eq(table.userWorkHours.tenantId, event.locals.tenant.id)
			)
		)
		.limit(1);

	if (existing) {
		// Update existing
		await db
			.update(table.userWorkHours)
			.set({
				workStartTime: data.workStartTime || null,
				workEndTime: data.workEndTime || null,
				workDays: data.workDays || null,
				remindersEnabled: data.remindersEnabled ?? true,
				updatedAt: new Date()
			})
			.where(eq(table.userWorkHours.id, existing.id));
	} else {
		// Create new
		const id = generateUserWorkHoursId();
		await db.insert(table.userWorkHours).values({
			id,
			userId: event.locals.user.id,
			tenantId: event.locals.tenant.id,
			workStartTime: data.workStartTime || null,
			workEndTime: data.workEndTime || null,
			workDays: data.workDays || null,
			remindersEnabled: data.remindersEnabled ?? true
		});
	}

	return { success: true };
});
