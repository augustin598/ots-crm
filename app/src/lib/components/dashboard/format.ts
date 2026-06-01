/* ===== Dashboard OTS — formatting helpers ===== */

export const fmtRON = (v: number) =>
	new Intl.NumberFormat('ro-RO', {
		style: 'currency',
		currency: 'RON',
		maximumFractionDigits: 0
	}).format(v);

export const fmtNum = (v: number) => new Intl.NumberFormat('ro-RO').format(v);

export const fmtPct = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;

/** Initials from a display name, e.g. "Carrefour România SA" → "CR". */
export function initials(name: string): string {
	const parts = name.trim().split(/\s+/).filter(Boolean);
	if (parts.length === 0) return '?';
	if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
	return (parts[0][0] + parts[1][0]).toUpperCase();
}

/** Romanian short relative time, e.g. "5 min", "2 ore", "3 zile". */
export function timeAgo(date: Date | string | null, now: Date = new Date()): string {
	if (!date) return '';
	const d = date instanceof Date ? date : new Date(date);
	const mins = Math.max(0, Math.floor((now.getTime() - d.getTime()) / 60000));
	if (mins < 1) return 'acum';
	if (mins < 60) return `${mins} min`;
	const hours = Math.floor(mins / 60);
	if (hours < 24) return `${hours} ${hours === 1 ? 'oră' : 'ore'}`;
	const days = Math.floor(hours / 24);
	if (days < 7) return `${days} ${days === 1 ? 'zi' : 'zile'}`;
	return d.toLocaleDateString('ro-RO', { day: 'numeric', month: 'short' });
}
