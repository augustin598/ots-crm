import { getCalendarClient } from './auth';
import { logInfo, logError, serializeError } from '$lib/server/logger';

export type CreateMeetEventInput = {
	tenantId: string;
	title: string;
	startTime: Date;
	durationMinutes: number;
	timezone: string;
	attendees: string[];
	description?: string;
};

export type CreateMeetEventResult = {
	eventId: string;
	hangoutLink: string;
};

export async function createMeetEvent(input: CreateMeetEventInput): Promise<CreateMeetEventResult> {
	const calendar = await getCalendarClient(input.tenantId);
	const endTime = new Date(input.startTime.getTime() + input.durationMinutes * 60_000);

	const requestBody = {
		summary: input.title,
		description: input.description ?? '',
		start: { dateTime: input.startTime.toISOString(), timeZone: input.timezone },
		end: { dateTime: endTime.toISOString(), timeZone: input.timezone },
		attendees: input.attendees.filter(Boolean).map((email) => ({ email })),
		conferenceData: {
			createRequest: {
				requestId: `ots-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
				conferenceSolutionKey: { type: 'hangoutsMeet' }
			}
		}
	};

	try {
		const res = await calendar.events.insert({
			calendarId: 'primary',
			conferenceDataVersion: 1,
			sendUpdates: 'all',
			requestBody
		});

		const eventId = res.data.id;
		const hangoutLink = res.data.hangoutLink;

		if (!eventId || !hangoutLink) {
			throw new Error('Calendar API returned event without id or hangoutLink');
		}

		logInfo('google-calendar', 'Meet event created', {
			tenantId: input.tenantId,
			metadata: { eventId, attendeeCount: input.attendees.length }
		});

		return { eventId, hangoutLink };
	} catch (err) {
		logError('google-calendar', 'createMeetEvent failed', {
			tenantId: input.tenantId,
			metadata: { error: serializeError(err) }
		});
		throw err;
	}
}

export type UpdateMeetEventInput = {
	tenantId: string;
	eventId: string;
	startTime?: Date;
	durationMinutes?: number;
	timezone?: string;
	attendees?: string[];
	title?: string;
	description?: string;
};

export async function updateMeetEvent(input: UpdateMeetEventInput): Promise<boolean> {
	const calendar = await getCalendarClient(input.tenantId);
	const requestBody: Record<string, unknown> = {};

	if (input.title !== undefined) requestBody.summary = input.title;
	if (input.description !== undefined) requestBody.description = input.description;

	if (input.startTime && input.durationMinutes !== undefined && input.timezone) {
		const endTime = new Date(input.startTime.getTime() + input.durationMinutes * 60_000);
		requestBody.start = { dateTime: input.startTime.toISOString(), timeZone: input.timezone };
		requestBody.end = { dateTime: endTime.toISOString(), timeZone: input.timezone };
	}

	if (input.attendees !== undefined) {
		requestBody.attendees = input.attendees.filter(Boolean).map((email) => ({ email }));
	}

	try {
		await calendar.events.patch({
			calendarId: 'primary',
			eventId: input.eventId,
			sendUpdates: 'all',
			requestBody
		});

		logInfo('google-calendar', 'Meet event updated', {
			tenantId: input.tenantId,
			metadata: { eventId: input.eventId, fields: Object.keys(requestBody) }
		});

		return true;
	} catch (err) {
		logError('google-calendar', 'updateMeetEvent failed', {
			tenantId: input.tenantId,
			metadata: { eventId: input.eventId, error: serializeError(err) }
		});
		throw err;
	}
}

export type DeleteMeetEventInput = {
	tenantId: string;
	eventId: string;
};

export async function deleteMeetEvent(input: DeleteMeetEventInput): Promise<boolean> {
	const calendar = await getCalendarClient(input.tenantId);

	try {
		await calendar.events.delete({
			calendarId: 'primary',
			eventId: input.eventId,
			sendUpdates: 'all'
		});

		logInfo('google-calendar', 'Meet event deleted', {
			tenantId: input.tenantId,
			metadata: { eventId: input.eventId }
		});

		return true;
	} catch (err: unknown) {
		const e = err as Record<string, unknown>;
		if (e?.code === 404 || (e?.response as Record<string, unknown>)?.status === 404) {
			logInfo('google-calendar', 'Meet event already gone (404 idempotent)', {
				tenantId: input.tenantId,
				metadata: { eventId: input.eventId }
			});
			return true;
		}
		logError('google-calendar', 'deleteMeetEvent failed', {
			tenantId: input.tenantId,
			metadata: { eventId: input.eventId, error: serializeError(err) }
		});
		throw err;
	}
}
