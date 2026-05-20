import type { AccountInGroup } from '$lib/remotes/hosting-accounts.remote';

export const CYCLE_LABEL: Record<string, string> = {
	monthly: 'Lunar',
	quarterly: 'Trimestrial',
	semiannually: 'Semestrial',
	biannually: 'Semestrial',
	annually: 'Anual',
	biennially: 'Bianual',
	triennially: 'Trianual',
	one_time: 'One-time'
};

export const STATUS_LABEL: Record<string, string> = {
	pending: 'în aștept.',
	active: 'active',
	suspended: 'suspended',
	terminated: 'terminated',
	cancelled: 'cancelled'
};

export const STATUS_CHIP: Record<string, string> = {
	pending: 'bg-yellow-50 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300',
	active: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
	suspended: 'bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300',
	terminated: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
	cancelled: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
};

export const INVOICE_STATUS_CHIP: Record<string, string> = {
	paid: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
	pending: 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
	sent: 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
	overdue: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300',
	partially_paid: 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
	draft: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
	cancelled: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
	'n/a': 'bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500'
};

/** Backwards-compat alias (older code imported these). */
export const STATUS_COLORS = STATUS_CHIP;
export const INVOICE_STATUS_COLORS = INVOICE_STATUS_CHIP;

/**
 * Package pill class — tints based on tier hint in the package name.
 * Class strings are LITERAL so Tailwind JIT picks them up.
 */
export function PACKAGE_CHIP(name: string | null | undefined): string {
	const n = (name ?? '').toLowerCase();
	if (n.includes('bronz')) return 'bg-amber-50 border-amber-200 text-amber-900 dark:bg-amber-950 dark:border-amber-800 dark:text-amber-200';
	if (n.includes('silver') || n.includes('argint')) return 'bg-slate-100 border-slate-300 text-slate-800 dark:bg-slate-700 dark:border-slate-600 dark:text-slate-100';
	if (n.includes('gold') || n.includes('aur')) return 'bg-yellow-50 border-yellow-200 text-yellow-900 dark:bg-yellow-950 dark:border-yellow-800 dark:text-yellow-200';
	if (n.includes('platin') || n.includes('diamond')) return 'bg-zinc-100 border-zinc-300 text-zinc-900 dark:bg-zinc-800 dark:border-zinc-600 dark:text-zinc-100';
	if (n.includes('extreme') || n.includes('premium') || n.includes('enterprise') || n.endsWith(' pro') || n === 'pro')
		return 'bg-purple-50 border-purple-200 text-purple-900 dark:bg-purple-950 dark:border-purple-800 dark:text-purple-200';
	if (n.includes('demo') || n.includes('trial') || n.includes('free'))
		return 'bg-sky-50 border-sky-200 text-sky-900 dark:bg-sky-950 dark:border-sky-800 dark:text-sky-200';
	if (n.includes('standard') || n.includes('basic'))
		return 'bg-emerald-50 border-emerald-200 text-emerald-900 dark:bg-emerald-950 dark:border-emerald-800 dark:text-emerald-200';
	return 'bg-indigo-50 border-indigo-200 text-indigo-900 dark:bg-indigo-950 dark:border-indigo-800 dark:text-indigo-200';
}

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
	if (days < 0) return `expirat de ${Math.abs(days)}z`;
	if (days === 0) return 'expiră azi';
	if (days === 1) return 'expiră mâine';
	if (days <= 30) return `în ${days} zile`;
	if (days <= 365) return `în ${days} zile`;
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
