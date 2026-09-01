// Helper-e UI pentru modulul PageSpeed — portate 1:1 din design (pagespeed-bits.jsx).
import type { PsiLevel } from '$lib/logic/pagespeed';

/** Culorile nivelurilor pentru elemente grafice (donut, spark, bare). */
export const PSI_LVL: Record<PsiLevel, string> = {
	good: '#10b981',
	ni: '#f59e0b',
	poor: '#ef4444',
	none: '#cbd5e1'
};

/** Culoarea textului din donut, per nivel — tokeni CSS ca să funcționeze și pe dark. */
export const PSI_LVL_TEXT: Record<PsiLevel, string> = {
	good: 'var(--psi-good-text)',
	ni: 'var(--psi-ni-text)',
	poor: 'var(--psi-poor-text)',
	none: 'var(--cl-text-3)'
};

/**
 * Attachment pentru dialoguri/drawere: focus la deschidere, trap de Tab în interior,
 * restaurarea focusului la închidere. Escape se tratează separat prin onkeydown.
 */
export function psiDialog(node: HTMLElement) {
	const previous = document.activeElement as HTMLElement | null;
	node.focus();
	const onKey = (e: KeyboardEvent) => {
		if (e.key !== 'Tab') return;
		const focusables = [
			...node.querySelectorAll<HTMLElement>(
				'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
			)
		];
		if (!focusables.length) return;
		const first = focusables[0];
		const last = focusables[focusables.length - 1];
		if (e.shiftKey && document.activeElement === first) {
			e.preventDefault();
			last.focus();
		} else if (!e.shiftKey && document.activeElement === last) {
			e.preventDefault();
			first.focus();
		}
	};
	node.addEventListener('keydown', onKey);
	return () => {
		node.removeEventListener('keydown', onKey);
		previous?.focus?.();
	};
}

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
	return `oklch(0.48 0.13 ${h})`;
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
