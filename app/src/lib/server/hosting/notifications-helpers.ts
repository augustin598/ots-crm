/**
 * Returns the calendar date in Europe/Bucharest as YYYY-MM-DD.
 * Used as a 24h dedupe bucket where midnight rollover into a new bucket is
 * acceptable.
 */
export function dayBucketEET(now: Date = new Date()): string {
	const formatter = new Intl.DateTimeFormat('sv-SE', {
		timeZone: 'Europe/Bucharest',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	});
	return formatter.format(now); // sv-SE locale gives YYYY-MM-DD format
}
