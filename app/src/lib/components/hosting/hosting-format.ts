import type { AccountInGroup } from '$lib/remotes/hosting-accounts.remote';

export const CYCLE_LABEL: Record<string, string> = {
	monthly: '/lună',
	quarterly: '/trim.',
	semiannually: '/6 luni',
	biannually: '/6 luni',
	annually: '/an',
	biennially: '/2 ani',
	triennially: '/3 ani',
	one_time: 'one-time'
};

export const STATUS_COLORS: Record<string, string> = {
	pending: 'bg-yellow-100 text-yellow-700',
	active: 'bg-green-100 text-green-700',
	suspended: 'bg-orange-100 text-orange-700',
	terminated: 'bg-red-100 text-red-700',
	cancelled: 'bg-slate-100 text-slate-600'
};

export const INVOICE_STATUS_COLORS: Record<string, string> = {
	paid: 'bg-emerald-100 text-emerald-700',
	pending: 'bg-amber-100 text-amber-700',
	sent: 'bg-amber-100 text-amber-700',
	overdue: 'bg-red-100 text-red-700',
	partially_paid: 'bg-blue-100 text-blue-700',
	draft: 'bg-slate-100 text-slate-600',
	cancelled: 'bg-slate-100 text-slate-500',
	'n/a': 'bg-slate-100 text-slate-400'
};

export function formatRON(cents: number | null | undefined, currency = 'RON'): string {
	return new Intl.NumberFormat('ro-RO', { style: 'currency', currency }).format((cents ?? 0) / 100);
}

export function formatDate(raw: string | null | undefined): string {
	if (!raw) return '—';
	const s = String(raw).trim();
	if (!s || s === '0000-00-00') return '—';
	const asNum = Number(s);
	if (Number.isFinite(asNum) && Math.abs(asNum) > 1_000_000_000_000) {
		const d = new Date(asNum);
		if (!Number.isNaN(d.getTime())) return d.toLocaleDateString('ro-RO');
	}
	try {
		const d = new Date(s);
		if (!Number.isNaN(d.getTime())) return d.toLocaleDateString('ro-RO');
	} catch {
		/* fall through */
	}
	return s.slice(0, 10);
}

export function countdownLabel(days: number | null | undefined): string | null {
	if (days === null || days === undefined) return null;
	if (days < 0) return `expirat acum ${Math.abs(days)} z.`;
	if (days === 0) return 'expiră azi';
	if (days === 1) return 'expiră mâine';
	if (days <= 30) return `în ${days} zile`;
	return null;
}

export function clientSinceLabel(iso: string | null | undefined): string | null {
	if (!iso) return null;
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return null;
	const years = new Date().getFullYear() - d.getFullYear();
	const yearLabel = years === 0 ? 'anul acesta' : `${years} an${years === 1 ? '' : 'i'}`;
	return `client din ${d.getFullYear()} · ${yearLabel}`;
}

/**
 * Pack semaphore color: 🔴 risc / 🟡 atenție / 🟢 OK.
 */
export function groupEdgeColor(opts: {
	overdueCount: number;
	suspendedCount: number;
	tier: string;
	nextExpiryDays: number | null;
}): 'green' | 'amber' | 'red' {
	if (opts.overdueCount > 0 || opts.suspendedCount > 0) return 'red';
	if (opts.tier === 'vip' || (opts.nextExpiryDays !== null && opts.nextExpiryDays <= 30))
		return 'amber';
	return 'green';
}

export function statusMixSegments(
	byStatus: Record<string, number>
): Array<{ status: string; pct: number; cls: string }> {
	const order = ['active', 'pending', 'suspended', 'terminated', 'cancelled'];
	const colors: Record<string, string> = {
		active: 'bg-emerald-500',
		pending: 'bg-yellow-400',
		suspended: 'bg-orange-500',
		terminated: 'bg-red-500',
		cancelled: 'bg-slate-400'
	};
	const total = Object.values(byStatus).reduce((s, n) => s + n, 0);
	if (total === 0) return [];
	return order
		.filter((s) => (byStatus[s] ?? 0) > 0)
		.map((s) => ({
			status: s,
			pct: ((byStatus[s] ?? 0) / total) * 100,
			cls: colors[s] ?? 'bg-slate-300'
		}));
}

export function isAddonsList(acc: AccountInGroup): string[] {
	return acc.additionalDomains ?? [];
}
