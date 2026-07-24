export interface SlotOpts {
	/** De unde pornește căutarea (exclus dacă e fix pe un slot ocupat). */
	from: Date;
	/** Câte sloturi să întoarcă. */
	count: number;
	/** Zilele săptămânii permise (0=dum..6=sâm). Gol → toate zilele. */
	daysOfWeek: number[];
	/** Ora publicării „HH:MM". */
	publishTime: string;
	/** Sloturi deja ocupate (se sar). */
	existing: Date[];
}

function parseHM(hm: string): { h: number; m: number } {
	const [h, m] = hm.split(':').map((x) => Number(x));
	return { h: Number.isFinite(h) ? h : 10, m: Number.isFinite(m) ? m : 0 };
}

/**
 * Următoarele `count` sloturi de publicare pornind de la `from`, pe zilele
 * permise, la `publishTime`, sărind peste `existing`. Pur (primește `from`,
 * nu citește ceasul). Guard: max 366 zile căutate.
 */
export function nextSlots(opts: SlotOpts): Date[] {
	const { h, m } = parseHM(opts.publishTime);
	const allowed = opts.daysOfWeek.length ? new Set(opts.daysOfWeek) : new Set([0, 1, 2, 3, 4, 5, 6]);
	const taken = new Set(opts.existing.map((d) => d.getTime()));

	const out: Date[] = [];
	const cursor = new Date(opts.from);
	cursor.setHours(h, m, 0, 0);
	// Dacă slotul de azi e deja în trecut față de `from`, treci la ziua următoare.
	if (cursor < opts.from) cursor.setDate(cursor.getDate() + 1);

	let guard = 0;
	while (out.length < opts.count && guard < 366) {
		if (allowed.has(cursor.getDay()) && !taken.has(cursor.getTime())) {
			out.push(new Date(cursor));
		}
		cursor.setDate(cursor.getDate() + 1);
		cursor.setHours(h, m, 0, 0);
		guard++;
	}
	return out;
}
