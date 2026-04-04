import { getDatePresets } from './report-helpers';

/** Stable keys for date presets (language-independent) */
export const DATE_PRESET_MAP: Record<string, string> = {
	maximum: 'Maximum',
	today: 'Azi',
	yesterday: 'Ieri',
	today_yesterday: 'Azi și ieri',
	last_7_days: 'Ultimele 7 zile',
	last_14_days: 'Ultimele 14 zile',
	last_28_days: 'Ultimele 28 zile',
	last_30_days: 'Ultimele 30 zile',
	this_week: 'Săptămâna aceasta',
	last_week: 'Săptămâna trecută',
	this_month: 'Luna aceasta',
	last_month: 'Luna trecută'
};

const LABEL_TO_KEY = new Map(Object.entries(DATE_PRESET_MAP).map(([k, v]) => [v, k]));

/** Resolve a preset key to absolute dates (recalculated each call) */
export function resolveDatePreset(key: string): { since: string; until: string } | null {
	const label = DATE_PRESET_MAP[key];
	if (!label) return null;
	const presets = getDatePresets();
	const match = presets.find(p => p.label === label);
	return match ? { since: match.since, until: match.until } : null;
}

/** Detect if a since/until pair matches a known preset. Returns key or null. */
export function detectDatePreset(since: string, until: string): string | null {
	const presets = getDatePresets();
	const match = presets.find(p => p.since === since && p.until === until);
	if (!match) return null;
	return LABEL_TO_KEY.get(match.label) ?? null;
}
