// Interviuri — clasificator sursă→canal + normalizatori pentru import.
// Sursă unică de adevăr pentru canalele-sistem seed-uite per tenant.

export interface DefaultChannel {
	name: string;
	color: string;
	icon: string; // cheie icon lucide (vezi ChannelIcon.svelte)
	sortOrder: number;
}

/** Canalele de marketing implicite (is_system=true), în ordinea de afișare. */
export const DEFAULT_CHANNELS: DefaultChannel[] = [
	{ name: 'TikTok', color: '#111827', icon: 'music', sortOrder: 10 },
	{ name: 'Google / SEO', color: '#ea4335', icon: 'search', sortOrder: 20 },
	{ name: 'Recomandare', color: '#10b981', icon: 'user-plus', sortOrder: 30 },
	{ name: 'Instagram', color: '#c13584', icon: 'instagram', sortOrder: 40 },
	{ name: 'Facebook', color: '#1877f2', icon: 'facebook', sortOrder: 50 },
	{ name: 'AI (ChatGPT)', color: '#8b5cf6', icon: 'sparkles', sortOrder: 60 },
	{ name: 'YouTube', color: '#e11d2a', icon: 'youtube', sortOrder: 70 },
	{ name: 'Site / Anunț', color: '#f59e0b', icon: 'globe', sortOrder: 80 },
	{ name: 'Nespecificat', color: '#94a3b8', icon: 'circle-help', sortOrder: 999 }
];

export const NESPECIFICAT = 'Nespecificat';

/**
 * Clasifică textul liber al sursei într-un canal normalizat (case-insensitive).
 * Ordinea contează: platformele sociale specifice au prioritate față de căutare.
 */
export function classifySource(raw: string | null | undefined): string {
	const s = (raw ?? '').toLowerCase().trim();
	if (!s) return NESPECIFICAT;

	if (/tik\s?tok/.test(s)) return 'TikTok';
	if (/youtube|you\s?tube|yt\b/.test(s)) return 'YouTube';
	if (/insta(gram)?|\big\b/.test(s)) return 'Instagram';
	if (/facebook|\bfb\b|meta\b/.test(s)) return 'Facebook';
	if (/chat\s?gpt|\bai\b|inteligen[țt]a? artificial/.test(s)) return 'AI (ChatGPT)';
	if (/google|c[ăa]utare|caut|seo|search|motor de c/.test(s)) return 'Google / SEO';
	if (/recomand|prieten|amic|cunosc|colega|coleg[ăa]|a mai fost|am mai/.test(s))
		return 'Recomandare';
	if (/olx|anun[țt]|site|website|pagin/.test(s)) return 'Site / Anunț';

	return NESPECIFICAT;
}

/** Normalizează valoarea studioului din Excel („A optat pentru?"). */
export function normalizeStudio(raw: string | null | undefined): string {
	const s = (raw ?? '').toLowerCase();
	if (/lucky/.test(s)) return 'Lucky Studio';
	if (/preziosa/.test(s)) return 'Preziosa Studio';
	// heylux / trainer / de acasa / gol → studioul principal
	return 'Heylux Studio';
}

/** Deduce statusul din coloanele „Admisa"/„Respinsa" ale Excel-ului. */
export function normalizeStatus(
	admisaCol: string | null | undefined,
	respinsaCol?: string | null | undefined
): 'admisa' | 'respinsa' | 'in_evaluare' {
	const s = `${admisaCol ?? ''} ${respinsaCol ?? ''}`.toLowerCase();
	if (/accept|admis/.test(s)) return 'admisa';
	if (/refuz|respin/.test(s)) return 'respinsa';
	return 'in_evaluare';
}

/** „dd.mm.yyyy" (sau Date din xlsx) → ISO „yyyy-mm-dd"; string gol dacă nu se poate. */
export function toIsoDate(raw: string | Date | null | undefined): string {
	if (!raw) return '';
	if (raw instanceof Date && !isNaN(raw.getTime())) {
		const y = raw.getFullYear();
		const m = String(raw.getMonth() + 1).padStart(2, '0');
		const d = String(raw.getDate()).padStart(2, '0');
		return `${y}-${m}-${d}`;
	}
	const str = String(raw).trim();
	let m = str.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})/);
	if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
	m = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
	if (m) return `${m[1]}-${m[2]}-${m[3]}`;
	return '';
}
