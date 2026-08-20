/**
 * Turns raw googleapis errors into something a CRM user can act on.
 *
 * Motivating incident (2026-08-20, task `zlg2grifajpwpygsdy6hzgsb`): every Meet
 * creation failed with `SERVICE_DISABLED` because Google Calendar API was never
 * enabled in the Cloud project. The CRM swallowed it, showed "Meeting programat",
 * and the only trace was a raw API sentence buried in `task_activity.new_value`.
 * Diagnosing it required a manual DB query. These mappings exist so the next
 * failure names itself in the UI.
 */

export type CalendarErrorKind =
	| 'api_disabled'
	| 'not_connected'
	| 'auth_expired'
	| 'forbidden'
	| 'rate_limited'
	| 'not_found'
	| 'invalid_request'
	| 'unknown';

export type CalendarErrorInfo = {
	kind: CalendarErrorKind;
	/** Romanian, user-facing, safe to render in a toast. */
	message: string;
	/** Console/admin URL the user should open, when there is one. */
	actionUrl: string | null;
	/** Raw upstream text, kept for `task_activity` / admin logs. */
	raw: string;
};

type LooseError = {
	message?: unknown;
	code?: unknown;
	name?: unknown;
	errors?: Array<{ reason?: string; message?: string }>;
	response?: { status?: number; data?: unknown };
};

function statusOf(err: LooseError): number | null {
	const fromResponse = err?.response?.status;
	if (typeof fromResponse === 'number') return fromResponse;
	if (typeof err?.code === 'number') return err.code;
	return null;
}

function rawTextOf(err: unknown): string {
	if (err instanceof Error) return err.message;
	if (typeof err === 'string') return err;
	try {
		return JSON.stringify(err);
	} catch {
		return String(err);
	}
}

/**
 * Extract the Cloud project id/number Google names in a `SERVICE_DISABLED`
 * message, so we can hand the user a link that lands on the right project.
 */
function projectIdFrom(text: string): string | null {
	const fromUrl = /[?&]project=([A-Za-z0-9-]+)/.exec(text);
	if (fromUrl) return fromUrl[1];
	const fromPhrase = /project\s+([A-Za-z0-9-]+)/i.exec(text);
	return fromPhrase ? fromPhrase[1] : null;
}

export function describeCalendarError(err: unknown): CalendarErrorInfo {
	const raw = rawTextOf(err);
	const e = (err ?? {}) as LooseError;
	const status = statusOf(e);
	const reasons = (e.errors ?? []).map((x) => x?.reason).filter(Boolean) as string[];
	const lower = raw.toLowerCase();

	if (e?.name === 'CalendarNotConnected') {
		return {
			kind: 'not_connected',
			message:
				'Google Calendar nu este conectat. Conectează-l din Setări → Google Calendar, apoi reîncearcă.',
			actionUrl: null,
			raw
		};
	}

	if (
		reasons.includes('accessNotConfigured') ||
		lower.includes('service_disabled') ||
		lower.includes('has not been used in project') ||
		lower.includes('is disabled')
	) {
		const project = projectIdFrom(raw);
		return {
			kind: 'api_disabled',
			message: project
				? `Google Calendar API nu este activat în proiectul Google Cloud ${project}. Activează-l, așteaptă 1-2 minute, apoi reîncearcă.`
				: 'Google Calendar API nu este activat în proiectul Google Cloud. Activează-l, așteaptă 1-2 minute, apoi reîncearcă.',
			actionUrl: project
				? `https://console.developers.google.com/apis/api/calendar-json.googleapis.com/overview?project=${project}`
				: 'https://console.developers.google.com/apis/api/calendar-json.googleapis.com/overview',
			raw
		};
	}

	if (
		lower.includes('invalid_grant') ||
		lower.includes('token has been expired or revoked') ||
		lower.includes('decrypt failed') ||
		status === 401
	) {
		return {
			kind: 'auth_expired',
			message:
				'Autorizarea Google Calendar a expirat sau a fost revocată. Reconectează contul din Setări → Google Calendar.',
			actionUrl: null,
			raw
		};
	}

	if (reasons.includes('insufficientPermissions') || lower.includes('insufficient')) {
		return {
			kind: 'forbidden',
			message:
				'Contul Google conectat nu are permisiunile necesare pe calendar. Reconectează-l și acceptă toate permisiunile cerute.',
			actionUrl: null,
			raw
		};
	}

	if (status === 429 || reasons.includes('rateLimitExceeded') || reasons.includes('userRateLimitExceeded')) {
		return {
			kind: 'rate_limited',
			message: 'Google a limitat temporar cererile (rate limit). Reîncearcă peste câteva minute.',
			actionUrl: null,
			raw
		};
	}

	if (status === 404) {
		return {
			kind: 'not_found',
			message: 'Evenimentul nu mai există în Google Calendar (a fost șters manual).',
			actionUrl: null,
			raw
		};
	}

	if (status === 400) {
		return {
			kind: 'invalid_request',
			message: `Google a respins cererea: ${raw}`,
			actionUrl: null,
			raw
		};
	}

	if (status === 403) {
		return {
			kind: 'forbidden',
			message: `Google a refuzat accesul: ${raw}`,
			actionUrl: null,
			raw
		};
	}

	return {
		kind: 'unknown',
		message: `Eroare Google Calendar: ${raw}`,
		actionUrl: null,
		raw
	};
}
