/**
 * Formatări pentru modulul „Bugete ore" — pure, testabile, fără DOM.
 *
 * `formatMinutes` din `$lib/logic/hourly-catalog` folosește minusul ASCII;
 * designul cere minusul tipografic („−1 h 30 min"), iar cifrele apar peste tot
 * cu `tabular-nums`. Ca să nu divergă cele două, formatul lung îl construim
 * aici pe aceeași regulă, cu semnul corect.
 */

/** Minusul tipografic U+2212, cel din handoff. */
const MINUS = '−';

/** 200 → „3 h 20 min"; 60 → „1 h"; 45 → „45 min"; −90 → „−1 h 30 min". */
export function fmtMinutes(minutes: number): string {
	if (!Number.isFinite(minutes)) return '—';
	const abs = Math.abs(Math.trunc(minutes));
	const h = Math.floor(abs / 60);
	const m = abs % 60;
	const body = h && m ? `${h} h ${m} min` : h ? `${h} h` : `${m} min`;
	return (minutes < 0 ? MINUS : '') + body;
}

/** Forma scurtă din tabele: 210 → „3,5 h"; 120 → „2 h". */
export function fmtHoursShort(minutes: number): string {
	if (!Number.isFinite(minutes)) return '—';
	const abs = Math.abs(minutes) / 60;
	const text = Number.isInteger(abs) ? String(abs) : abs.toFixed(1).replace('.', ',');
	return (minutes < 0 ? MINUS : '') + text + ' h';
}

/** Cenți → „1.234,56 €" (sau altă monedă), în formatul ro-RO. */
export function fmtMoneyCents(cents: number, currency = 'EUR'): string {
	return new Intl.NumberFormat('ro-RO', {
		style: 'currency',
		currency,
		minimumFractionDigits: 2
	}).format(cents / 100);
}

/** Echivalentul în euro al unui credit, la tariful de referință. */
export function creditToEur(minutes: number, referenceRateEur: number | null): string | null {
	if (!referenceRateEur || referenceRateEur <= 0) return null;
	const eur = (minutes / 60) * referenceRateEur;
	return new Intl.NumberFormat('ro-RO', { maximumFractionDigits: 0 }).format(eur) + ' €';
}

export function fmtDate(d: Date | string | null | undefined): string {
	if (!d) return '—';
	return new Date(d).toLocaleDateString('ro-RO', {
		day: 'numeric',
		month: 'short',
		year: 'numeric'
	});
}

export function fmtDateShort(d: Date | string | null | undefined): string {
	if (!d) return '—';
	return new Date(d).toLocaleDateString('ro-RO', { day: 'numeric', month: 'short' });
}

/** „acum 2 zile", „azi", „ieri" — meta din rândul de client. */
export function fmtRelative(d: Date | string | null | undefined): string {
	if (!d) return 'niciodată';
	const then = new Date(d);
	const days = Math.floor((Date.now() - then.getTime()) / 86_400_000);
	if (days <= 0) return 'azi';
	if (days === 1) return 'ieri';
	if (days < 7) return `acum ${days} zile`;
	if (days < 14) return 'acum o săptămână';
	if (days < 31) return `acum ${Math.floor(days / 7)} săptămâni`;
	if (days < 62) return 'acum o lună';
	return `acum ${Math.floor(days / 30)} luni`;
}

/** Inițialele pentru avatar: „Beauty One Medical" → „BO". */
export function initialsOf(name: string): string {
	const parts = name.trim().split(/\s+/).filter(Boolean);
	if (parts.length === 0) return '?';
	if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
	return (parts[0][0] + parts[1][0]).toUpperCase();
}

/**
 * Culoarea avatarului — deterministă din id, ca același client să aibă mereu
 * aceeași culoare, fără să ținem una în bază. Paleta e cea din handoff.
 */
const AVATAR_COLORS = [
	'#1877F2',
	'#a855f7',
	'#f59e0b',
	'#10b981',
	'#ef4444',
	'#0ea5e9',
	'#64748b'
] as const;

export function avatarColor(id: string): string {
	let hash = 0;
	for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
	return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

/**
 * Culoarea unei specializări — aceeași peste tot: barele din raportul lunar,
 * chipul din cardul taskului, punctul din „Consum pe taskuri".
 *
 * Deterministă din slug, NU din poziția în listă: altfel Development ar fi
 * albastru azi și verde mâine, doar pentru că s-a schimbat ordinea în Settings.
 * Slug-urile cunoscute au culoarea din handoff; restul primesc una stabilă din
 * aceeași paletă.
 */
const RATE_COLORS = [
	'#1877F2',
	'#a855f7',
	'#f59e0b',
	'#10b981',
	'#0ea5e9',
	'#ef4444',
	'#64748b'
] as const;

const KNOWN_RATE_COLORS: Record<string, string> = {
	development: '#1877F2',
	'design-ui-ux': '#0ea5e9',
	design: '#0ea5e9',
	'project-management': '#f59e0b',
	'devops-api': '#a855f7',
	devops: '#a855f7',
	seo: '#10b981',
	ads: '#ef4444',
	'ads-performance': '#ef4444'
};

export function rateColor(slug: string | null | undefined): string {
	if (!slug) return '#64748b';
	const known = KNOWN_RATE_COLORS[slug];
	if (known) return known;
	let hash = 0;
	for (let i = 0; i < slug.length; i++) hash = (hash * 31 + slug.charCodeAt(i)) >>> 0;
	return RATE_COLORS[hash % RATE_COLORS.length];
}

/** Acronime care rămân cu majuscule când formatăm un slug pentru afișare. */
const ACRONYMS = new Set(['ui', 'ux', 'api', 'seo', 'qa', 'crm', 'ads', 'devops']);

/** „design-ui-ux" → „Design UI/UX"; „development" → „Development". */
export function prettyRateLabel(slug: string | null | undefined): string {
	if (!slug) return '—';
	const parts = slug.split('-').filter(Boolean);
	const words = parts.map((p) =>
		ACRONYMS.has(p) ? p.toUpperCase() : p.charAt(0).toUpperCase() + p.slice(1)
	);
	// „ui ux" arată mai bine ca „UI/UX".
	return words.join(' ').replace(/\bUI UX\b/, 'UI/UX');
}

/** Etichetele regimurilor — fixe (slug-urile sunt închise în `RATE_MODE_SLUGS`). */
const MODE_LABELS: Record<string, string> = {
	standard: 'Standard',
	urgent: 'Urgență',
	weekend: 'Weekend',
	night: 'Noapte'
};

export function prettyModeLabel(slug: string | null | undefined): string {
	if (!slug) return '—';
	return MODE_LABELS[slug] ?? prettyRateLabel(slug);
}

/** Regimurile au propriul cod de culoare: neutru la standard, cald la urgență/noapte. */
const MODE_COLORS: Record<string, string> = {
	standard: '#64748b',
	urgent: '#f59e0b',
	weekend: '#a855f7',
	night: '#6366f1'
};

export function modeColor(slug: string | null | undefined): string {
	if (!slug) return '#64748b';
	return MODE_COLORS[slug] ?? '#64748b';
}
