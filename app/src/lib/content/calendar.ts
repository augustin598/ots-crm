/** O zi din grila de calendar. `iso` = YYYY-MM-DD (cheie stabilă pt maparea articolelor). */
export interface CalendarDay {
	iso: string;
	day: number;
	inMonth: boolean;
}

function pad(n: number): string {
	return n < 10 ? `0${n}` : String(n);
}
function isoOf(d: Date): string {
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Grilă lunară cu săptămâna începând LUNI. `month` e 0-based (0=ian).
 * Întoarce array de săptămâni (fiecare 7 zile), umplut cu zile din lunile
 * vecine pt aliniere. Pur — nu citește ceasul.
 */
export function buildMonthGrid(year: number, month: number): CalendarDay[][] {
	const first = new Date(year, month, 1);
	// getDay(): 0=dum..6=sâm → offset ca luni=0.
	const offset = (first.getDay() + 6) % 7;
	const start = new Date(year, month, 1 - offset);

	const weeks: CalendarDay[][] = [];
	const cursor = new Date(start);
	// Umple săptămâni întregi până depășim luna curentă (minim 5, uneori 6).
	do {
		const week: CalendarDay[] = [];
		for (let i = 0; i < 7; i++) {
			week.push({ iso: isoOf(cursor), day: cursor.getDate(), inMonth: cursor.getMonth() === month });
			cursor.setDate(cursor.getDate() + 1);
		}
		weeks.push(week);
	} while (cursor.getMonth() === month || cursor <= new Date(year, month + 1, 0));
	return weeks;
}
