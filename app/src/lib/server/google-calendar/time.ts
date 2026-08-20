/**
 * Wall-clock ("naive") datetime helpers for Google Calendar.
 *
 * WHY THIS EXISTS
 * ---------------
 * The CRM stores `task.meetTime` as a wall-clock string produced by the
 * `<input type="date">` + `<input type="time">` pair, e.g. `"2026-08-21T10:00"`.
 * That string carries **no UTC offset**: it means "10:00 in Romania", nothing else.
 *
 * The old code did `new Date("2026-08-21T10:00")`, which JavaScript interprets in
 * the *server's* timezone, then sent `date.toISOString()` (always suffixed `Z`)
 * together with `timeZone: 'Europe/Bucharest'`. Two bugs stacked:
 *
 *   1. Production runs in a container without `TZ`, i.e. UTC, so 10:00 became
 *      10:00Z. Locally (macOS, Europe/Bucharest) it became 07:00Z. Same input,
 *      different instant — dev could never reproduce prod.
 *   2. Google Calendar **ignores** `start.timeZone` when `start.dateTime` already
 *      carries an offset, so the `Europe/Bucharest` hint never corrected it.
 *      A 10:00 meeting landed at 13:00 in the user's calendar.
 *
 * The fix is to never build an absolute instant. Per the Calendar API contract
 * ("A time zone offset is required unless a time zone is explicitly specified in
 * timeZone"), we send an offset-free RFC3339 local time plus the IANA zone and
 * let Google resolve the instant — which also makes DST transitions Google's
 * problem rather than ours.
 */

/** `YYYY-MM-DDTHH:mm:ss` — RFC3339 local time, deliberately without an offset. */
export type NaiveDateTime = string;

const NAIVE_RE = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/;

type Parts = {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
	second: number;
};

function pad(n: number, width = 2): string {
	return String(n).padStart(width, '0');
}

function format(p: Parts): NaiveDateTime {
	return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
}

/**
 * Render an absolute instant as wall-clock time in `timeZone`.
 * Only used to migrate legacy values that were stored *with* an offset.
 */
function instantToWallClock(instant: Date, timeZone: string): NaiveDateTime {
	const fmt = new Intl.DateTimeFormat('en-US', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		// h23 (not hour12:false) — hour12:false emits "24" for midnight on some ICU builds.
		hourCycle: 'h23'
	});

	const lookup: Record<string, string> = {};
	for (const part of fmt.formatToParts(instant)) {
		if (part.type !== 'literal') lookup[part.type] = part.value;
	}

	return format({
		year: Number(lookup.year),
		month: Number(lookup.month),
		day: Number(lookup.day),
		hour: Number(lookup.hour),
		minute: Number(lookup.minute),
		second: Number(lookup.second)
	});
}

/**
 * Normalise any stored `meetTime` into an offset-free `YYYY-MM-DDTHH:mm:ss`
 * expressed in `timeZone`.
 *
 * - `"2026-08-21T10:00"`        → `"2026-08-21T10:00:00"` (already wall-clock, kept verbatim)
 * - `"2026-08-21T07:00:00.000Z"` → `"2026-08-21T10:00:00"` (legacy absolute value, converted)
 *
 * @throws if the value is not a datetime we can interpret.
 */
export function toNaiveDateTime(raw: string, timeZone: string): NaiveDateTime {
	const trimmed = String(raw ?? '').trim();
	if (!trimmed) {
		throw new Error('Ora meeting-ului lipsește.');
	}

	const m = NAIVE_RE.exec(trimmed);
	if (m) {
		const parts: Parts = {
			year: Number(m[1]),
			month: Number(m[2]),
			day: Number(m[3]),
			hour: Number(m[4]),
			minute: Number(m[5]),
			second: Number(m[6] ?? 0)
		};
		// Reject impossible wall-clock values (e.g. month 13, hour 25) that the
		// regex shape alone would happily accept.
		if (
			parts.month < 1 ||
			parts.month > 12 ||
			parts.day < 1 ||
			parts.day > 31 ||
			parts.hour > 23 ||
			parts.minute > 59 ||
			parts.second > 59
		) {
			throw new Error(`Dată/oră invalidă pentru meeting: "${trimmed}".`);
		}
		return format(parts);
	}

	// Legacy shape: carries an offset (or is otherwise Date-parseable).
	const instant = new Date(trimmed);
	if (Number.isNaN(instant.getTime())) {
		throw new Error(
			`Dată/oră invalidă pentru meeting: "${trimmed}" (aștept ceva de forma 2026-08-21T10:00).`
		);
	}
	return instantToWallClock(instant, timeZone);
}

/**
 * Add minutes to a wall-clock time, staying on the wall clock.
 *
 * Arithmetic runs through `Date.UTC` purely as a calendar calculator — UTC has
 * no DST, so "10:00 + 30min = 10:30" holds regardless of the target zone. Google
 * resolves both endpoints against `timeZone` afterwards.
 */
export function addMinutes(naive: NaiveDateTime, minutes: number): NaiveDateTime {
	const m = NAIVE_RE.exec(naive);
	if (!m) {
		throw new Error(`addMinutes a primit o valoare non-naive: "${naive}"`);
	}

	const anchor = Date.UTC(
		Number(m[1]),
		Number(m[2]) - 1,
		Number(m[3]),
		Number(m[4]),
		Number(m[5]),
		Number(m[6] ?? 0)
	);
	const shifted = new Date(anchor + minutes * 60_000);

	return format({
		year: shifted.getUTCFullYear(),
		month: shifted.getUTCMonth() + 1,
		day: shifted.getUTCDate(),
		hour: shifted.getUTCHours(),
		minute: shifted.getUTCMinutes(),
		second: shifted.getUTCSeconds()
	});
}

/** `"2026-08-21T10:00:00"` → `"2026-08-21"`. Used for user-facing messages. */
export function naiveDatePart(naive: NaiveDateTime): string {
	return naive.slice(0, 10);
}
