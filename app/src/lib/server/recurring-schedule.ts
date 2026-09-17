/**
 * Programarea șabloanelor de facturi recurente la nivel de ZI calendaristică
 * (ora României), nu la milisecundă.
 *
 * Incident 2026-09-17 (Lucky Group, Digital Marketing): nextRunDate se calcula
 * din momentul generării (`now`), așa că purta ora exactă a rulării din luna
 * trecută — 06:00:04.016Z, după 4 s de procesat alte șabloane. Jobul de a doua
 * zi pornea la 06:00:00.112Z, `nextRunDate <= now` era fals și factura sărea o
 * zi; data nouă pleca apoi din ziua întârziată, deci alunecarea se acumula.
 *
 * Două bariere:
 * - `dueCutoffIso`: jobul ia tot ce e programat până la finalul zilei curente;
 * - `nextScheduledRunDate`: data următoare pleacă de la data PROGRAMATĂ și e
 *   stocată la 00:00:00.000Z, ca datele alese din UI.
 */

const TZ = 'Europe/Bucharest';

const dayKeyFormatter = new Intl.DateTimeFormat('en-CA', {
	timeZone: TZ,
	year: 'numeric',
	month: '2-digit',
	day: '2-digit'
});

/** 'YYYY-MM-DD' al zilei din București în care cade momentul dat. */
function bucharestDayKey(date: Date): string {
	return dayKeyFormatter.format(date);
}

/**
 * Pragul pentru `next_run_date <= ?`: finalul zilei curente din București, în
 * același format ISO ca valorile stocate (zi calendaristică la miezul nopții UTC).
 */
export function dueCutoffIso(now: Date): string {
	return `${bucharestDayKey(now)}T23:59:59.999Z`;
}

function addInterval(
	y: number,
	m: number,
	d: number,
	recurringType: string,
	recurringInterval: number
): [number, number, number] {
	switch (recurringType) {
		case 'daily':
		case 'weekly': {
			const days = recurringType === 'daily' ? recurringInterval : recurringInterval * 7;
			const next = new Date(Date.UTC(y, m, d + days));
			return [next.getUTCFullYear(), next.getUTCMonth(), next.getUTCDate()];
		}
		case 'monthly':
		case 'yearly': {
			const months = recurringType === 'monthly' ? recurringInterval : recurringInterval * 12;
			const targetY = y + Math.floor((m + months) / 12);
			const targetM = (m + months) % 12;
			// 31 ian + 1 lună = 28/29 feb, nu 3 martie.
			const lastDay = new Date(Date.UTC(targetY, targetM + 1, 0)).getUTCDate();
			return [targetY, targetM, Math.min(d, lastDay)];
		}
		default:
			throw new Error(`Unknown recurring type: ${recurringType}`);
	}
}

/**
 * Următoarea dată de rulare după o generare: ciclurile se adună la data
 * programată până se ajunge DUPĂ ziua curentă. Consecințe:
 * - rularea întârziată nu mută ziua de facturare;
 * - generarea manuală înainte de termen trece la ciclul următor celui programat;
 * - o restanță de luni sare ciclurile trecute, fără câte o factură în fiecare zi.
 */
export function nextScheduledRunDate(
	scheduled: Date,
	recurringType: string,
	recurringInterval: number,
	now: Date
): Date {
	const interval = Math.max(1, Math.floor(recurringInterval) || 1);
	let [y, m, d] = bucharestDayKey(scheduled).split('-').map(Number) as [number, number, number];
	m -= 1;
	const todayKey = bucharestDayKey(now);
	const keyOf = (yy: number, mm: number, dd: number) =>
		`${yy}-${String(mm + 1).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;

	// Cel puțin un ciclu; plafonul oprește o buclă pe o dată coruptă.
	for (let i = 0; i < 10_000; i++) {
		[y, m, d] = addInterval(y, m, d, recurringType, interval);
		if (keyOf(y, m, d) > todayKey) break;
	}
	return new Date(Date.UTC(y, m, d));
}
