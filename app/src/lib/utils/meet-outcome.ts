import { toast } from 'svelte-sonner';

/**
 * Shape returned by `createTask` / `updateTask` / `scheduleMeet` describing what
 * happened to the task's Google Calendar event. Mirrors `MeetSyncOutcome` on the
 * server (`$lib/server/google-calendar/task-meet-sync`).
 */
export type MeetOutcome = {
	status:
		| 'created'
		| 'updated'
		| 'deleted'
		| 'unchanged'
		| 'not_connected'
		| 'pending_link'
		| 'failed';
	eventId: string | null;
	meetLink: string | null;
	message: string | null;
	actionUrl: string | null;
} | null;

/**
 * Turn a sync outcome into the right toast.
 *
 * Every Meet path used to fire `toast.success('Meeting programat')` regardless of
 * what Google said. On 2026-08-20 that hid a `SERVICE_DISABLED` error for two
 * days: the user was told the meeting was scheduled while nothing ever reached a
 * calendar. Success is now only claimed when an event actually exists.
 */
export function reportMeetOutcome(outcome: MeetOutcome, fallback = 'Meeting programat'): void {
	if (!outcome) {
		toast.success(fallback);
		return;
	}

	switch (outcome.status) {
		case 'created':
			toast.success('Meeting programat · link Meet generat și trimis participanților');
			return;
		case 'updated':
			toast.success('Meeting actualizat în Google Calendar');
			return;
		case 'deleted':
			toast.success('Meeting-ul a fost șters din Google Calendar');
			return;
		case 'pending_link':
			toast.warning(outcome.message ?? 'Linkul Meet încă se generează.', { duration: 8000 });
			return;
		case 'not_connected':
			toast.warning(outcome.message ?? 'Google Calendar nu este conectat.', { duration: 8000 });
			return;
		case 'failed':
			toast.error(outcome.message ?? 'Nu s-a putut crea evenimentul în Google Calendar.', {
				duration: 15000,
				...(outcome.actionUrl
					? {
							action: {
								label: 'Rezolvă',
								onClick: () => window.open(outcome.actionUrl as string, '_blank', 'noopener')
							}
						}
					: {})
			});
			return;
		default:
			toast.success(fallback);
	}
}
