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
			taskRemindersEnabled: true,
			clientEmailsEnabled: false,
			clientEmailOnTaskCreated: true,
			clientEmailOnStatusChange: true,
			clientEmailOnComment: true,
			clientEmailOnTaskModified: true,
			internalEmailOnComment: true
		};
	}

	return {
		taskRemindersEnabled: settings.taskRemindersEnabled ?? true,
		clientEmailsEnabled: settings.clientEmailsEnabled ?? false,
		clientEmailOnTaskCreated: settings.clientEmailOnTaskCreated ?? true,
		clientEmailOnStatusChange: settings.clientEmailOnStatusChange ?? true,
		clientEmailOnComment: settings.clientEmailOnComment ?? true,
		clientEmailOnTaskModified: settings.clientEmailOnTaskModified ?? true,
		internalEmailOnComment: settings.internalEmailOnComment ?? true
	};
});

export const updateTaskSettings = command(
	v.object({
		taskRemindersEnabled: v.optional(v.boolean()),
		clientEmailsEnabled: v.optional(v.boolean()),
		clientEmailOnTaskCreated: v.optional(v.boolean()),
		clientEmailOnStatusChange: v.optional(v.boolean()),
		clientEmailOnComment: v.optional(v.boolean()),
		clientEmailOnTaskModified: v.optional(v.boolean()),
		internalEmailOnComment: v.optional(v.boolean())
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
			await db
				.update(table.taskSettings)
				.set({
					taskRemindersEnabled: data.taskRemindersEnabled,
					clientEmailsEnabled: data.clientEmailsEnabled,
					clientEmailOnTaskCreated: data.clientEmailOnTaskCreated,
					clientEmailOnStatusChange: data.clientEmailOnStatusChange,
					clientEmailOnComment: data.clientEmailOnComment,
					clientEmailOnTaskModified: data.clientEmailOnTaskModified,
					internalEmailOnComment: data.internalEmailOnComment,
					updatedAt: new Date()
				})
				.where(eq(table.taskSettings.tenantId, event.locals.tenant.id));
		} else {
			const settingsId = generateTaskSettingsId();
			await db.insert(table.taskSettings).values({
				id: settingsId,
				tenantId: event.locals.tenant.id,
				taskRemindersEnabled: data.taskRemindersEnabled ?? true,
				clientEmailsEnabled: data.clientEmailsEnabled ?? false,
				clientEmailOnTaskCreated: data.clientEmailOnTaskCreated ?? true,
				clientEmailOnStatusChange: data.clientEmailOnStatusChange ?? true,
				clientEmailOnComment: data.clientEmailOnComment ?? true,
				clientEmailOnTaskModified: data.clientEmailOnTaskModified ?? true,
				internalEmailOnComment: data.internalEmailOnComment ?? true
			});
		}

		return { success: true };
	}
);
