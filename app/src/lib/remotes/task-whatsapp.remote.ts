import { command, getRequestEvent, query } from '$app/server';
import * as v from 'valibot';
import { and, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { recordTaskActivity } from '$lib/server/task-activity';
import { logInfo } from '$lib/server/logger';

/**
 * Legătura task ↔ grup WhatsApp (etapa 2).
 *
 * Citirea e pentru orice membru al echipei (tenantUser), niciodată pentru
 * portalul clientului. Scrierea e doar owner/admin: fiecare schimbare de
 * status ajunge la oameni din afara firmei, deci e o decizie de divulgare,
 * la fel ca `setWhatsappGroupClient`.
 */

function assertTenantMember() {
	const event = getRequestEvent();
	if (!event?.locals.user || !event?.locals.tenant || !event?.locals.tenantUser) {
		throw new Error('Unauthorized');
	}
	const role = event.locals.tenantUser.role;
	return {
		userId: event.locals.user.id,
		tenantId: event.locals.tenant.id,
		canEdit: role === 'owner' || role === 'admin'
	};
}

export type TaskWhatsappGroupOption = {
	id: string;
	groupJid: string;
	subject: string;
	participantCount: number;
	hasAvatar: boolean;
	clientId: string | null;
};

export const getTaskWhatsappLink = query(v.pipe(v.string(), v.minLength(1)), async (taskId) => {
	const { tenantId, canEdit } = assertTenantMember();

	const [task] = await db
		.select({
			id: table.task.id,
			clientId: table.task.clientId,
			whatsappGroupId: table.task.whatsappGroupId
		})
		.from(table.task)
		.where(and(eq(table.task.id, taskId), eq(table.task.tenantId, tenantId)))
		.limit(1);
	if (!task) throw new Error('Task not found');

	const groups = await db
		.select({
			id: table.whatsappGroup.id,
			groupJid: table.whatsappGroup.groupJid,
			subject: table.whatsappGroup.subject,
			participantCount: table.whatsappGroup.participantCount,
			avatarPath: table.whatsappGroup.avatarPath,
			clientId: table.whatsappGroup.clientId,
			watched: table.whatsappGroup.watched
		})
		.from(table.whatsappGroup)
		.where(eq(table.whatsappGroup.tenantId, tenantId));

	const toOption = (g: (typeof groups)[number]): TaskWhatsappGroupOption => ({
		id: g.id,
		groupJid: g.groupJid,
		subject: g.subject,
		participantCount: g.participantCount,
		hasAvatar: Boolean(g.avatarPath),
		clientId: g.clientId
	});

	const linkedRow = task.whatsappGroupId
		? (groups.find((g) => g.id === task.whatsappGroupId) ?? null)
		: null;
	const watchedGroups = groups.filter((g) => g.watched);

	// Propunere: clientul task-ului are exact un grup bifat. Decizia rămâne la om.
	const forClient = task.clientId ? watchedGroups.filter((g) => g.clientId === task.clientId) : [];
	const suggestion = forClient.length === 1 ? toOption(forClient[0]) : null;

	return {
		canEdit,
		linked: linkedRow ? { ...toOption(linkedRow), watched: linkedRow.watched } : null,
		suggestion,
		// Doar admin primește lista (și doar grupurile bifate, ca la trimiterea manuală).
		options: canEdit
			? watchedGroups
					.map(toOption)
					.sort((a, b) => a.subject.localeCompare(b.subject, 'ro'))
			: []
	};
});

export const setTaskWhatsappGroup = command(
	v.object({
		taskId: v.pipe(v.string(), v.minLength(1)),
		/** null = dezleagă. */
		groupId: v.nullable(v.pipe(v.string(), v.minLength(1)))
	}),
	async ({ taskId, groupId }) => {
		const { tenantId, userId, canEdit } = assertTenantMember();
		if (!canEdit) throw new Error('Doar un administrator poate lega un task de un grup WhatsApp.');

		const [task] = await db
			.select({ id: table.task.id, whatsappGroupId: table.task.whatsappGroupId })
			.from(table.task)
			.where(and(eq(table.task.id, taskId), eq(table.task.tenantId, tenantId)))
			.limit(1);
		if (!task) throw new Error('Task not found');

		let subject: string | null = null;
		if (groupId) {
			const [group] = await db
				.select({
					id: table.whatsappGroup.id,
					subject: table.whatsappGroup.subject,
					watched: table.whatsappGroup.watched
				})
				.from(table.whatsappGroup)
				.where(and(eq(table.whatsappGroup.id, groupId), eq(table.whatsappGroup.tenantId, tenantId)))
				.limit(1);
			if (!group) throw new Error('Grupul nu există.');
			if (!group.watched) {
				throw new Error('Grupul nu e în lista celor urmărite. Bifează-l întâi din „Grupuri".');
			}
			subject = group.subject;
		}

		if ((task.whatsappGroupId ?? null) === groupId) return { success: true, changed: false };

		await db
			.update(table.task)
			.set({ whatsappGroupId: groupId, updatedAt: new Date() })
			.where(and(eq(table.task.id, taskId), eq(table.task.tenantId, tenantId)));

		await recordTaskActivity({
			taskId,
			userId,
			tenantId,
			action: groupId ? 'whatsapp_group_linked' : 'whatsapp_group_unlinked',
			field: 'whatsappGroup',
			newValue: subject
		});

		logInfo('whatsapp', groupId ? `task legat de grupul „${subject}"` : 'task dezlegat de grup', {
			tenantId,
			userId,
			metadata: { taskId, groupId }
		});

		return { success: true, changed: true };
	}
);
