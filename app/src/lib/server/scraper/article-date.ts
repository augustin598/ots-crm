/** Extrage data publicării articolului din HTML (meta tags, time, JSON-LD) */
export function extractArticlePublishedDate(html: string): string | null {
	// 1. Meta article:published_time / og:published_time
	const metaMatch = html.match(
		/<meta[^>]*(?:property|name)=["'](?:article:published_time|og:published_time)["'][^>]*content=["']([^"']+)["']/i
	) || html.match(
		/<meta[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:article:published_time|og:published_time)["']/i
	);
	if (metaMatch?.[1]) {
		const d = parseDateToIso(metaMatch[1]);
		if (d) return d;
	}
	// 2. <time datetime="...">
	const timeMatch = html.match(/<time[^>]*datetime=["']([^"']+)["']/i);
	if (timeMatch?.[1]) {
		const d = parseDateToIso(timeMatch[1]);
		if (d) return d;
	}
	// 3. JSON-LD datePublished
	const jsonLdMatch = html.match(/"datePublished"\s*:\s*"([^"]+)"/);
	if (jsonLdMatch?.[1]) {
		const d = parseDateToIso(jsonLdMatch[1]);
		if (d) return d;
	}
	// 4. Meta dc.date / publication
	const dcMatch = html.match(/<meta[^>]*(?:name|property)=["'](?:dc\.date|date|publication_date)["'][^>]*content=["']([^"']+)["']/i)
		|| html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*(?:name|property)=["'](?:dc\.date|date)["']/i);
	if (dcMatch?.[1]) {
		const d = parseDateToIso(dcMatch[1]);
		if (d) return d;
	}
	// 5. <dt>Publicat</dt><dd>...</dd> (pattern CMS românesc)
	const dtPublicatMatch = html.match(/<dt[^>]*>\s*Publicat\s*<\/dt>\s*<dd[^>]*>([^<]+)/i);
	if (dtPublicatMatch?.[1]) {
		const raw = dtPublicatMatch[1].trim();
		const d = parseDateToIso(raw) ?? parseRomanianRelativeDate(raw) ?? parseRomanianAbsoluteDate(raw);
		if (d) return d;
	}
	// 6. <dt>Modificat</dt><dd>...</dd> (fallback când nu există dată publicare)
	const dtModificatMatch = html.match(/<dt[^>]*>\s*Modific[aă]t\s*<\/dt>\s*<dd[^>]*>([^<]+)/i);
	if (dtModificatMatch?.[1]) {
		const raw = dtModificatMatch[1].trim();
		const d = parseDateToIso(raw) ?? parseRomanianRelativeDate(raw) ?? parseRomanianAbsoluteDate(raw);
		if (d) return d;
	}
	// 7. Elemente cu class date/time/posted ce conțin text cu dată
	const classDateMatch = html.match(
		/class=["'][^"']*(?:dat[ae]|entry-date|post(?:ed|date|ing)|creat|public)[^"']*["'][^>]*>\s*([^<]{5,60})/i
	);
	if (classDateMatch?.[1]) {
		const raw = classDateMatch[1].trim();
		const d = parseDateToIso(raw) ?? parseRomanianRelativeDate(raw) ?? parseRomanianAbsoluteDate(raw);
		if (d) return d;
	}
	return null;
}

export function parseDateToIso(val: string): string | null {
	try {
		const d = new Date(val);
		if (isNaN(d.getTime())) return null;
		return d.toISOString().slice(0, 19) + 'Z';
	} catch {
		return null;
	}
}

/** Parsează o dată relativă în română ("acum 3 ani si 1 luna", "acum 2 luni" etc.) */
export function parseRomanianRelativeDate(val: string): string | null {
	const s = val.trim();
	const now = new Date();

	// "acum X ani si/și Y luni/luna/lună"
	const m1 = s.match(/acum\s+(\d+)\s+ani?\s+(?:si|și)\s+(\d+)\s+lun[aăi]/i);
	if (m1) {
		const d = new Date(now);
		d.setFullYear(d.getFullYear() - parseInt(m1[1]));
		d.setMonth(d.getMonth() - parseInt(m1[2]));
		return d.toISOString().slice(0, 10) + 'T00:00:00Z';
	}
	// "acum X ani"
	const m2 = s.match(/acum\s+(\d+)\s+ani?(?:\s|$)/i);
	if (m2) {
		const d = new Date(now);
		d.setFullYear(d.getFullYear() - parseInt(m2[1]));
		return d.toISOString().slice(0, 10) + 'T00:00:00Z';
	}
	// "acum X luni/luna/lună"
	const m3 = s.match(/acum\s+(\d+)\s+lun[aăi]/i);
	if (m3) {
		const d = new Date(now);
		d.setMonth(d.getMonth() - parseInt(m3[1]));
		return d.toISOString().slice(0, 10) + 'T00:00:00Z';
	}
	// "acum X săptămâni/saptamani"
	const m4 = s.match(/acum\s+(\d+)\s+s[aă]pt[aă]m[aâ]ni?/i);
	if (m4) {
		const d = new Date(now);
		d.setDate(d.getDate() - parseInt(m4[1]) * 7);
		return d.toISOString().slice(0, 10) + 'T00:00:00Z';
	}
	// "acum X zile"
	const m5 = s.match(/acum\s+(\d+)\s+zile?/i);
	if (m5) {
		const d = new Date(now);
		d.setDate(d.getDate() - parseInt(m5[1]));
		return d.toISOString().slice(0, 10) + 'T00:00:00Z';
	}
	// "acum o zi"
	if (/acum\s+o\s+zi/i.test(s)) {
		const d = new Date(now);
		d.setDate(d.getDate() - 1);
		return d.toISOString().slice(0, 10) + 'T00:00:00Z';
	}
	return null;
}

/** Parsează o dată absolută în română ("25 mai 2023", "mai 2023", "25.05.2023") */
export function parseRomanianAbsoluteDate(val: string): string | null {
	const MONTHS: Record<string, number> = {
		ian: 1, feb: 2, mar: 3, apr: 4, mai: 5, iun: 6,
		iul: 7, aug: 8, sep: 9, oct: 10, noi: 11, dec: 12
	};
	const MON_PAT =
		'(ian(?:uarie)?|feb(?:ruarie)?|mar(?:tie)?|apr(?:ilie)?|mai|iun(?:ie)?|iul(?:ie)?|aug(?:ust)?|sep(?:tembrie)?|oct(?:ombrie)?|noi(?:embrie)?|dec(?:embrie)?)';

	// "25 mai 2023" / "25 mai, 2023"
	const m1 = val.match(new RegExp(`(\\d{1,2})\\s+${MON_PAT}[.,]?\\s*(\\d{4})`, 'i'));
	if (m1) {
		const key = m1[2].toLowerCase().slice(0, 3);
		const month = MONTHS[key];
		if (month) {
			const d = new Date(parseInt(m1[3]), month - 1, parseInt(m1[1]));
			return d.toISOString().slice(0, 10) + 'T00:00:00Z';
		}
	}
	// "mai 2023" (lună + an)
	const m2 = val.match(new RegExp(`${MON_PAT}\\s+(\\d{4})`, 'i'));
	if (m2) {
		const key = m2[1].toLowerCase().slice(0, 3);
		const month = MONTHS[key];
		if (month) {
			const d = new Date(parseInt(m2[2]), month - 1, 1);
			return d.toISOString().slice(0, 10) + 'T00:00:00Z';
		}
	}
	return null;
}
