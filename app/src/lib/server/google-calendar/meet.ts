import type { calendar_v3 } from 'googleapis';
import { getCalendarClient } from './auth';
import { addMinutes, type NaiveDateTime } from './time';
import { logInfo, logWarning, logError, serializeError } from '$lib/server/logger';

/**
 * `startTime` is a wall-clock string (`YYYY-MM-DDTHH:mm:ss`, no offset) that is
 * interpreted in `timezone` by Google. Build it with `toNaiveDateTime()` from
 * `./time` — never with `Date.toISOString()`, which pins an absolute instant and
 * makes Google ignore the `timeZone` field. See the comment block in `./time.ts`.
 */
export type CreateMeetEventInput = {
	tenantId: string;
	title: string;
	startTime: NaiveDateTime;
	durationMinutes: number;
	timezone: string;
	attendees: string[];
	description?: string;
};

export type CreateMeetEventResult = {
	eventId: string;
	/**
	 * `null` when Google accepted the event but has not finished provisioning the
	 * conference yet. The event exists and must still be persisted, otherwise it
	 * is orphaned in the calendar with no way for the CRM to update or delete it.
	 */
	hangoutLink: string | null;
};

/**
 * Pull the Meet URL out of an event payload.
 *
 * `hangoutLink` is the documented field, but it is absent while
 * `conferenceData.createRequest.status` is still `pending`, in which case the
 * video entry point may already be populated.
 */
function extractMeetLink(data: calendar_v3.Schema$Event | undefined): string | null {
	if (!data) return null;
	if (data.hangoutLink) return data.hangoutLink;

	const entryPoints = data.conferenceData?.entryPoints ?? [];
	const video = entryPoints.find((ep) => ep.entryPointType === 'video' && ep.uri);
	return video?.uri ?? null;
}

function conferenceCreateRequest() {
	return {
		createRequest: {
			// Google dedupes on requestId; a fresh one per call is what we want,
			// since every call here is a deliberate user action.
			requestId: `ots-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
			conferenceSolutionKey: { type: 'hangoutsMeet' }
		}
	};
}

/**
 * Re-read an event to pick up a Meet link that was still being provisioned when
 * the write returned. Never throws — a missing link is reported, not fatal.
 */
export async function fetchMeetLink(tenantId: string, eventId: string): Promise<string | null> {
	try {
		const calendar = await getCalendarClient(tenantId);
		const res = await calendar.events.get({ calendarId: 'primary', eventId });
		return extractMeetLink(res.data);
	} catch (err) {
		logWarning('google-calendar', 'fetchMeetLink failed', {
			tenantId,
			metadata: { eventId, error: serializeError(err) }
		});
		return null;
	}
}

export async function createMeetEvent(input: CreateMeetEventInput): Promise<CreateMeetEventResult> {
	const calendar = await getCalendarClient(input.tenantId);
	const endTime = addMinutes(input.startTime, input.durationMinutes);

	const requestBody = {
		summary: input.title,
		description: input.description ?? '',
		// Offset-free local time + explicit zone: the only combination in which
		// Google honours `timeZone`.
		start: { dateTime: input.startTime, timeZone: input.timezone },
		end: { dateTime: endTime, timeZone: input.timezone },
		attendees: input.attendees.filter(Boolean).map((email) => ({ email })),
		conferenceData: conferenceCreateRequest()
	};

	try {
		const res = await calendar.events.insert({
			calendarId: 'primary',
			conferenceDataVersion: 1,
			sendUpdates: 'all',
			requestBody
		});

		const eventId = res.data.id;
		if (!eventId) {
			// No id means nothing was created — safe to fail loudly.
			throw new Error('Calendar API returned an event without an id');
		}

		let hangoutLink = extractMeetLink(res.data);

		if (!hangoutLink) {
			// The event is already on the calendar; only the conference is lagging.
			// One re-read usually settles it. Throwing here (the old behaviour) left
			// a real event in the calendar that the CRM had no id for.
			logWarning('google-calendar', 'Meet link missing on insert, re-reading event', {
				tenantId: input.tenantId,
				metadata: {
					eventId,
					createRequestStatus: res.data.conferenceData?.createRequest?.status?.statusCode ?? null
				}
			});
			hangoutLink = await fetchMeetLink(input.tenantId, eventId);
		}

		logInfo('google-calendar', 'Meet event created', {
			tenantId: input.tenantId,
			metadata: {
				eventId,
				attendeeCount: input.attendees.length,
				start: input.startTime,
				end: endTime,
				timezone: input.timezone,
				hasMeetLink: Boolean(hangoutLink)
			}
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
	startTime?: NaiveDateTime;
	durationMinutes?: number;
	timezone?: string;
	attendees?: string[];
	title?: string;
	description?: string;
	/** Attach a Meet conference if the event does not have one yet. */
	ensureConference?: boolean;
};

export type UpdateMeetEventResult = {
	ok: boolean;
	/** Present so callers can heal a task row whose `meetLink` went missing. */
	hangoutLink: string | null;
};

export async function updateMeetEvent(input: UpdateMeetEventInput): Promise<UpdateMeetEventResult> {
	const calendar = await getCalendarClient(input.tenantId);
	const requestBody: Record<string, unknown> = {};

	if (input.title !== undefined) requestBody.summary = input.title;
	if (input.description !== undefined) requestBody.description = input.description;

	if (input.startTime && input.durationMinutes !== undefined && input.timezone) {
		const endTime = addMinutes(input.startTime, input.durationMinutes);
		requestBody.start = { dateTime: input.startTime, timeZone: input.timezone };
		requestBody.end = { dateTime: endTime, timeZone: input.timezone };
	}

	if (input.attendees !== undefined) {
		requestBody.attendees = input.attendees.filter(Boolean).map((email) => ({ email }));
	}

	if (input.ensureConference) {
		requestBody.conferenceData = conferenceCreateRequest();
	}

	try {
		const res = await calendar.events.patch({
			calendarId: 'primary',
			eventId: input.eventId,
			sendUpdates: 'all',
			...(input.ensureConference ? { conferenceDataVersion: 1 } : {}),
			requestBody
		});

		let hangoutLink = extractMeetLink(res.data);
		if (!hangoutLink && input.ensureConference) {
			hangoutLink = await fetchMeetLink(input.tenantId, input.eventId);
		}

		logInfo('google-calendar', 'Meet event updated', {
			tenantId: input.tenantId,
			metadata: {
				eventId: input.eventId,
				fields: Object.keys(requestBody),
				hasMeetLink: Boolean(hangoutLink)
			}
		});

		return { ok: true, hangoutLink };
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
