import { query, command, getRequestEvent } from '$app/server';
import * as v from 'valibot';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { encodeBase32LowerCase } from '@oslojs/encoding';

function generateTaskSettingsId() {
	const bytes = crypto.getRandomValues(new Uint8Array(15));
	return encodeBase32LowerCase(bytes);
}

export const getTaskSettings = query(async () => {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant) {
		throw new Error('Unauthorized');
	}

	const [settings] = await db
		.select()
		.from(table.taskSettings)
		.where(eq(table.taskSettings.tenantId, event.locals.tenant.id))
		.limit(1);

	// Return default settings if none exist
	if (!settings) {
		return {
			taskRemindersEnabled: true
		};
	}

	return {
		taskRemindersEnabled: settings.taskRemindersEnabled ?? true
	};
});

export const updateTaskSettings = command(
	v.object({
		taskRemindersEnabled: v.optional(v.boolean())
	}),
	async (data) => {
		const event = getRequestEvent();
		if (!event?.locals.user || !event?.locals.tenant) {
			throw new Error('Unauthorized');
		}

		// Only owners and admins can update task settings
		if (event.locals.tenantUser?.role !== 'owner' && event.locals.tenantUser?.role !== 'admin') {
			throw new Error('Insufficient permissions');
		}

		// Check if settings exist
		const [existing] = await db
			.select()
			.from(table.taskSettings)
			.where(eq(table.taskSettings.tenantId, event.locals.tenant.id))
			.limit(1);

		if (existing) {
			// Update existing settings
			await db
				.update(table.taskSettings)
				.set({
					taskRemindersEnabled: data.taskRemindersEnabled !== undefined ? data.taskRemindersEnabled : undefined,
					updatedAt: new Date()
				})
				.where(eq(table.taskSettings.tenantId, event.locals.tenant.id));
		} else {
			// Create new settings
			const settingsId = generateTaskSettingsId();
			await db.insert(table.taskSettings).values({
				id: settingsId,
				tenantId: event.locals.tenant.id,
				taskRemindersEnabled: data.taskRemindersEnabled ?? true
			});
		}

		return { success: true };
	}
);
