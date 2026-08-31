// Helper-e UI pentru modulul PageSpeed — portate 1:1 din design (pagespeed-bits.jsx).
import type { PsiLevel } from '$lib/logic/pagespeed';

/** Culorile nivelurilor pentru elemente grafice (donut, spark, bare). */
export const PSI_LVL: Record<PsiLevel, string> = {
	good: '#10b981',
	ni: '#f59e0b',
	poor: '#ef4444',
	none: '#cbd5e1'
};

/** Culoarea textului din donut, per nivel (contrast pe suprafață albă). */
export const PSI_LVL_TEXT: Record<PsiLevel, string> = {
	good: '#047857',
	ni: '#b45309',
	poor: '#b91c1c',
	none: 'var(--cl-text-3)'
};

export function psiInitials(domain: string | null | undefined): string {
	return (domain || '?').replace(/^www\./, '').slice(0, 2).toUpperCase();
}

function psiHash(s: string): number {
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}

/** Culoare stabilă de „favicon" derivată din id (identică vizual cu designul). */
export function psiTileColor(id: string): string {
	const h = Math.round((psiHash(id || 'x') / 4294967296) * 360);
	return `oklch(0.58 0.13 ${h})`;
}

/** Formatare dată+oră românească scurtă: „24 aug. 2026, 07:04". */
export function psiFmtDateTime(value: Date | string | null | undefined): string {
	if (!value) return '—';
	const d = typeof value === 'string' ? new Date(value) : value;
	return d.toLocaleDateString('ro-RO', { day: 'numeric', month: 'short', year: 'numeric' }) +
		', ' +
		d.toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit' });
}

export function psiFmtDate(value: Date | string | null | undefined): string {
	if (!value) return '—';
	const d = typeof value === 'string' ? new Date(value) : value;
	return d.toLocaleDateString('ro-RO', { day: 'numeric', month: 'short', year: 'numeric' });
}
