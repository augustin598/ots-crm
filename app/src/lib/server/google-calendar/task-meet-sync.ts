/**
 * Single owner of "keep this task's Google Calendar event in sync".
 *
 * The create / update / schedule paths in `tasks.remote.ts` each grew their own
 * copy of this logic and drifted apart: only one of them could update an
 * existing event, only one set `type = 'meeting'`, and all three reported
 * failure by writing a `meet_event_failed` row nobody surfaced. Centralising it
 * means a fix lands once, and every path returns the same outcome shape so the
 * UI can actually tell the user what happened.
 */

import { and, eq, inArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import * as table from '$lib/server/db/schema';
import { recordTaskActivity } from '$lib/server/task-activity';
import { getCalendarStatus } from './auth';
import { createMeetEvent, updateMeetEvent, deleteMeetEvent } from './meet';
import { describeCalendarError } from './errors';
import { toNaiveDateTime } from './time';
import { logWarning } from '$lib/server/logger';

/** All CRM meetings are scheduled in Romanian wall-clock time. */
export const MEET_TIMEZONE = 'Europe/Bucharest';

export type MeetSyncStatus =
	| 'created'
	| 'updated'
	| 'deleted'
	| 'unchanged'
	| 'not_connected'
	| 'pending_link'
	| 'failed';

export type MeetSyncOutcome = {
	status: MeetSyncStatus;
	eventId: string | null;
	meetLink: string | null;
	/** Romanian, user-facing. `null` when everything worked silently. */
	message: string | null;
	/** Google Cloud console URL when the failure is a configuration problem. */
	actionUrl: string | null;
};

const OK: MeetSyncOutcome = {
	status: 'unchanged',
	eventId: null,
	meetLink: null,
	message: null,
	actionUrl: null
};

/**
 * Everyone who should receive the invite: task assignees plus the client contact.
 *
 * `explicitAssigneeUserIds` covers task creation, where the caller already knows
 * the assignees and the `task_assignee` rows may not be readable yet in the same
 * logical step.
 */
async function resolveAttendees(params: {
	tenantId: string;
	taskId: string;
	clientId?: string | null;
	explicitAssigneeUserIds?: string[];
}): Promise<string[]> {
	const emails = new Set<string>();

	const assigneeRows = await db
		.select({ email: table.user.email })
		.from(table.taskAssignee)
		.innerJoin(table.user, eq(table.taskAssignee.userId, table.user.id))
		.where(eq(table.taskAssignee.taskId, params.taskId));
	for (const row of assigneeRows) {
		if (row.email) emails.add(row.email.toLowerCase());
	}

	if (params.explicitAssigneeUserIds?.length) {
		const rows = await db
			.select({ email: table.user.email })
			.from(table.user)
			.where(inArray(table.user.id, params.explicitAssigneeUserIds));
		for (const row of rows) {
			if (row.email) emails.add(row.email.toLowerCase());
		}
	}

	if (params.clientId) {
		const [clientRow] = await db
			.select({ email: table.client.email })
			.from(table.client)
			.where(
				and(eq(table.client.id, params.clientId), eq(table.client.tenantId, params.tenantId))
			)
			.limit(1);
		if (clientRow?.email) emails.add(clientRow.email.toLowerCase());
	}

	return [...emails];
}

async function persistMeetState(params: {
	taskId: string;
	tenantId: string;
	meetLink: string | null;
	eventId: string | null;
	/** Keeps the calendar diff-sync in `updateTask` from deleting the event later. */
	markAsMeeting: boolean;
}) {
	const patch: Record<string, unknown> = {
		meetLink: params.meetLink,
		googleCalendarEventId: params.eventId,
		updatedAt: new Date()
	};
	if (params.markAsMeeting) patch.type = 'meeting';

	await db
		.update(table.task)
		.set(patch)
		.where(and(eq(table.task.id, params.taskId), eq(table.task.tenantId, params.tenantId)));
}

async function recordFailure(params: {
	taskId: string;
	tenantId: string;
	actorUserId: string;
	stage: string;
	err: unknown;
}): Promise<MeetSyncOutcome> {
	const info = describeCalendarError(params.err);

	await recordTaskActivity({
		taskId: params.taskId,
		userId: params.actorUserId,
		tenantId: params.tenantId,
		action: 'meet_event_failed',
		newValue: JSON.stringify({
			stage: params.stage,
			kind: info.kind,
			message: info.message,
			actionUrl: info.actionUrl,
			error: info.raw.slice(0, 500)
		})
	});

	return {
		status: 'failed',
		eventId: null,
		meetLink: null,
		message: info.message,
		actionUrl: info.actionUrl
	};
}

export type EnsureTaskMeetEventParams = {
	tenantId: string;
	taskId: string;
	actorUserId: string;
	/** Which caller we are, for the activity trail. */
	stage: 'create' | 'update' | 'schedule';
	title: string;
	description?: string | null;
	clientId?: string | null;
	/** Wall-clock string as stored on the task, e.g. `"2026-08-21T10:00"`. */
	meetTime: string;
	durationMinutes: number;
	existingEventId?: string | null;
	explicitAssigneeUserIds?: string[];
	/** Set `task.type = 'meeting'` on success. */
	markAsMeeting?: boolean;
};

/**
 * Create the Calendar event, or update it when one already exists.
 *
 * Never throws: a calendar problem must not roll back the task write that
 * triggered it. The outcome tells the caller what to show the user.
 */
export async function ensureTaskMeetEvent(
	params: EnsureTaskMeetEventParams
): Promise<MeetSyncOutcome> {
	let startTime: string;
	try {
		startTime = toNaiveDateTime(params.meetTime, MEET_TIMEZONE);
	} catch (err) {
		return recordFailure({
			taskId: params.taskId,
			tenantId: params.tenantId,
			actorUserId: params.actorUserId,
			stage: params.stage,
			err
		});
	}

	const calStatus = await getCalendarStatus(params.tenantId);
	if (!calStatus.connected) {
		return {
			status: 'not_connected',
			eventId: null,
			meetLink: null,
			message:
				'Google Calendar nu este conectat, deci nu s-a generat link Meet. Conectează-l din Setări → Google Calendar.',
			actionUrl: null
		};
	}

	const attendees = await resolveAttendees({
		tenantId: params.tenantId,
		taskId: params.taskId,
		clientId: params.clientId,
		explicitAssigneeUserIds: params.explicitAssigneeUserIds
	});

	try {
		if (params.existingEventId) {
			const res = await updateMeetEvent({
				tenantId: params.tenantId,
				eventId: params.existingEventId,
				title: params.title,
				description: params.description ?? undefined,
				startTime,
				durationMinutes: params.durationMinutes,
				timezone: MEET_TIMEZONE,
				attendees,
				// Heals events that exist without a conference attached.
				ensureConference: true
			});

			await persistMeetState({
				taskId: params.taskId,
				tenantId: params.tenantId,
				meetLink: res.hangoutLink,
				eventId: params.existingEventId,
				markAsMeeting: params.markAsMeeting ?? false
			});

			await recordTaskActivity({
				taskId: params.taskId,
				userId: params.actorUserId,
				tenantId: params.tenantId,
				action: 'meet_event_updated',
				newValue: JSON.stringify({
					eventId: params.existingEventId,
					start: startTime,
					attendeeCount: attendees.length
				})
			});

			return {
				status: 'updated',
				eventId: params.existingEventId,
				meetLink: res.hangoutLink,
				message: null,
				actionUrl: null
			};
		}

		const res = await createMeetEvent({
			tenantId: params.tenantId,
			title: params.title,
			startTime,
			durationMinutes: params.durationMinutes,
			timezone: MEET_TIMEZONE,
			attendees,
			description: params.description ?? undefined
		});

		// Persist even when the link is still pending — the event is already on the
		// calendar and without its id we could never update or delete it again.
		await persistMeetState({
			taskId: params.taskId,
			tenantId: params.tenantId,
			meetLink: res.hangoutLink,
			eventId: res.eventId,
			markAsMeeting: params.markAsMeeting ?? false
		});

		if (!res.hangoutLink) {
			await recordTaskActivity({
				taskId: params.taskId,
				userId: params.actorUserId,
				tenantId: params.tenantId,
				action: 'meet_event_orphaned',
				newValue: JSON.stringify({ eventId: res.eventId, reason: 'conference_pending' })
			});

			logWarning('google-calendar', 'Calendar event created without Meet link', {
				tenantId: params.tenantId,
				metadata: { taskId: params.taskId, eventId: res.eventId }
			});

			return {
				status: 'pending_link',
				eventId: res.eventId,
				meetLink: null,
				message:
					'Evenimentul a fost creat în Google Calendar, dar linkul Meet încă se generează. Reîncearcă în câteva secunde.',
				actionUrl: null
			};
		}

		await recordTaskActivity({
			taskId: params.taskId,
			userId: params.actorUserId,
			tenantId: params.tenantId,
			action: 'meet_event_created',
			newValue: JSON.stringify({
				eventId: res.eventId,
				start: startTime,
				attendeeCount: attendees.length
			})
		});

		return {
			status: 'created',
			eventId: res.eventId,
			meetLink: res.hangoutLink,
			message: null,
			actionUrl: null
		};
	} catch (err) {
		return recordFailure({
			taskId: params.taskId,
			tenantId: params.tenantId,
			actorUserId: params.actorUserId,
			stage: params.stage,
			err
		});
	}
}

/** Remove a task's Calendar event. Never throws, for the same reason as above. */
export async function removeTaskMeetEvent(params: {
	tenantId: string;
	taskId: string;
	actorUserId: string;
	eventId: string;
}): Promise<MeetSyncOutcome> {
	const calStatus = await getCalendarStatus(params.tenantId);
	if (!calStatus.connected) return OK;

	try {
		await deleteMeetEvent({ tenantId: params.tenantId, eventId: params.eventId });

		await db
			.update(table.task)
			.set({ meetLink: null, googleCalendarEventId: null, updatedAt: new Date() })
			.where(and(eq(table.task.id, params.taskId), eq(table.task.tenantId, params.tenantId)));

		await recordTaskActivity({
			taskId: params.taskId,
			userId: params.actorUserId,
			tenantId: params.tenantId,
			action: 'meet_event_deleted',
			newValue: JSON.stringify({ eventId: params.eventId })
		});

		return {
			status: 'deleted',
			eventId: params.eventId,
			meetLink: null,
			message: null,
			actionUrl: null
		};
	} catch (err) {
		return recordFailure({
			taskId: params.taskId,
			tenantId: params.tenantId,
			actorUserId: params.actorUserId,
			stage: 'delete',
			err
		});
	}
}
