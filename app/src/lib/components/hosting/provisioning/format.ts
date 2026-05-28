/* Helper de formatare pentru pagina Provisioning */

export function fmtDuration(ms: number | null | undefined): string {
	if (ms == null) return '—';
	if (ms < 1000) return `${ms}ms`;
	return `${(ms / 1000).toFixed(1)}s`;
}

const MS_DAY = 24 * 60 * 60 * 1000;

/** Format relativ: "azi, 14:34", "ieri, 21:22", "acum 2 zile", "27 mai" */
export function fmtRelative(iso: string): { main: string; sub: string } {
	const d = new Date(iso);
	if (isNaN(d.getTime())) return { main: iso, sub: '' };

	const now = new Date();
	const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
	const yesterdayStart = todayStart - MS_DAY;
	const t = d.getTime();

	const hh = String(d.getHours()).padStart(2, '0');
	const mm = String(d.getMinutes()).padStart(2, '0');
	const time = `${hh}:${mm}`;

	if (t >= todayStart) return { main: 'azi', sub: time };
	if (t >= yesterdayStart) return { main: 'ieri', sub: time };

	const daysAgo = Math.floor((todayStart - t) / MS_DAY);
	if (daysAgo <= 7) return { main: `acum ${daysAgo + 1} zile`, sub: time };

	const month = d.toLocaleDateString('ro-RO', { month: 'short' });
	return { main: `${d.getDate()} ${month}`, sub: time };
}

export function fmtRelativeFull(iso: string): string {
	const r = fmtRelative(iso);
	return r.sub ? `${r.main}, ${r.sub}` : r.main;
}
