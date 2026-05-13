<script lang="ts">
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import {
		getHostingAccounts,
		updateHostingAccountClient,
		syncAllHostingAccounts
	} from '$lib/remotes/hosting-accounts.remote';
	import { getClients } from '$lib/remotes/clients.remote';
	import Combobox from '$lib/components/ui/combobox/combobox.svelte';
	import type { Option } from '$lib/components/ui/combobox/combobox-types';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import SearchIcon from '@lucide/svelte/icons/search';
	import AlertCircleIcon from '@lucide/svelte/icons/alert-circle';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';

	const tenantSlug = $derived(page.params.tenant);
	let statusFilter = $state('');
	let clientSearch = $state('');
	let groupByClient = $state(true); // default ON per user request
	let showOnlyUnassigned = $state(false);

	let accounts = $state(getHostingAccounts({ status: statusFilter || undefined, limit: 500 }));
	const allClients = getClients();

	function refresh() {
		accounts = getHostingAccounts({ status: statusFilter || undefined, limit: 500 });
	}

	const statusColors: Record<string, string> = {
		pending: 'bg-yellow-100 text-yellow-700',
		active: 'bg-green-100 text-green-700',
		suspended: 'bg-orange-100 text-orange-700',
		terminated: 'bg-red-100 text-red-700',
		cancelled: 'bg-slate-100 text-slate-600'
	};

	function formatRON(cents: number | null | undefined, currency = 'RON') {
		return new Intl.NumberFormat('ro-RO', { style: 'currency', currency }).format(
			(cents ?? 0) / 100
		);
	}

	/**
	 * Tier-coded Tailwind classes for hosting package badges.
	 * Class strings are LITERAL so Tailwind JIT picks them up at build time —
	 * dynamic `bg-${color}-100` wouldn't work. Returns text + bg + border + dark variants.
	 *
	 * Color theory:
	 *  - Bronze   → amber  (warm metallic, entry tier)
	 *  - Silver   → slate  (cool metallic, mid tier)
	 *  - Gold     → yellow (bright premium)
	 *  - Platinum → zinc   (cool premium, distinct from silver)
	 *  - Extreme/Pro/Premium → purple (top tier, distinct from "metals")
	 *  - Demo/Trial/Free → blue (testing/temporary)
	 *  - Standard/default → emerald (baseline)
	 *  - Unknown → indigo (neutral but visible)
	 *
	 * `synced=false` adds a dashed border to visually indicate "stale / not from DA".
	 */
	function packageClasses(name: string | null | undefined, synced: boolean): string {
		const n = (name ?? '').toLowerCase().trim();
		const borderStyle = synced ? 'border-transparent' : 'border-dashed';

		// Bronz/Bronze
		if (n.includes('bronz'))
			return `bg-amber-100 text-amber-900 ${borderStyle === 'border-dashed' ? 'border-dashed border-amber-400' : 'border-amber-200'} dark:bg-amber-950 dark:text-amber-200 dark:border-amber-800`;
		// Silver / Argint
		if (n.includes('silver') || n.includes('argint'))
			return `bg-slate-200 text-slate-900 ${borderStyle === 'border-dashed' ? 'border-dashed border-slate-400' : 'border-slate-300'} dark:bg-slate-700 dark:text-slate-100 dark:border-slate-600`;
		// Gold / Aur
		if (n.includes('gold') || n.includes('aur'))
			return `bg-yellow-100 text-yellow-900 ${borderStyle === 'border-dashed' ? 'border-dashed border-yellow-400' : 'border-yellow-300'} dark:bg-yellow-900 dark:text-yellow-100 dark:border-yellow-700`;
		// Platinum / Diamond
		if (n.includes('platin') || n.includes('diamond'))
			return `bg-zinc-100 text-zinc-900 ${borderStyle === 'border-dashed' ? 'border-dashed border-zinc-400' : 'border-zinc-300'} dark:bg-zinc-800 dark:text-zinc-100 dark:border-zinc-600`;
		// Extreme / Pro / Premium / Enterprise
		if (
			n.includes('extreme') ||
			n.includes('premium') ||
			n.includes('enterprise') ||
			n.endsWith(' pro') ||
			n === 'pro'
		)
			return `bg-purple-100 text-purple-900 ${borderStyle === 'border-dashed' ? 'border-dashed border-purple-400' : 'border-purple-200'} dark:bg-purple-950 dark:text-purple-200 dark:border-purple-800`;
		// Demo / Trial / Free
		if (n.includes('demo') || n.includes('trial') || n.includes('free'))
			return `bg-sky-100 text-sky-900 ${borderStyle === 'border-dashed' ? 'border-dashed border-sky-400' : 'border-sky-200'} dark:bg-sky-950 dark:text-sky-200 dark:border-sky-800`;
		// Standard / Basic / default
		if (n.includes('standard') || n.includes('basic') || n === 'default')
			return `bg-emerald-50 text-emerald-900 ${borderStyle === 'border-dashed' ? 'border-dashed border-emerald-400' : 'border-emerald-200'} dark:bg-emerald-950 dark:text-emerald-200 dark:border-emerald-800`;

		// Unknown — neutral but distinct
		return `bg-indigo-50 text-indigo-900 ${borderStyle === 'border-dashed' ? 'border-dashed border-indigo-400' : 'border-indigo-200'} dark:bg-indigo-950 dark:text-indigo-200 dark:border-indigo-800`;
	}

	/**
	 * Defensive date formatter. Some rows imported before `dateStrings: true` was applied
	 * have stored millisecond timestamps as text (e.g. "1778619600000.0"). Detect those and
	 * convert; otherwise treat as YYYY-MM-DD ISO string.
	 */
	function formatDate(raw: string | null | undefined): string {
		if (!raw) return '—';
		const s = String(raw).trim();
		if (!s || s === '0000-00-00') return '—';
		const asNum = Number(s);
		if (Number.isFinite(asNum) && Math.abs(asNum) > 1_000_000_000_000) {
			const d = new Date(asNum);
			if (!Number.isNaN(d.getTime())) {
				return d.toLocaleDateString('ro-RO');
			}
		}
		try {
			const d = new Date(s);
			if (!Number.isNaN(d.getTime())) return d.toLocaleDateString('ro-RO');
		} catch {
			/* fall through */
		}
		return s.slice(0, 10);
	}

	type Account = {
		id: string;
		domain: string;
		daUsername: string;
		status: string;
		recurringAmount: number | null;
		currency: string | null;
		billingCycle: string | null;
		daPackageName: string | null;
		linkedPackageName: string | null;
		additionalDomains: string[] | null;
		clientId: string | null;
		clientName: string | null;
		clientBusinessName: string | null;
		clientEmail: string | null;
		clientCui: string | null;
		serverName: string | null;
		startDate: string | null;
		nextDueDate: string | null;
	};

	const CYCLE_MONTHS: Record<string, number> = {
		monthly: 1,
		quarterly: 3,
		semiannually: 6,
		biannually: 6,
		annually: 12,
		biennially: 24,
		triennially: 36,
		one_time: 0
	};

	const CYCLE_LABEL: Record<string, string> = {
		monthly: '/lună',
		quarterly: '/trim.',
		semiannually: '/6 luni',
		biannually: '/6 luni',
		annually: '/an',
		biennially: '/2 ani',
		triennially: '/3 ani',
		one_time: 'one-time'
	};

	/**
	 * Convert a recurring amount (in cents, for its native cycle) to monthly cents.
	 * one_time and unknown cycles return 0 — they don't contribute to MRR.
	 */
	function toMonthlyCents(amount: number | null, cycle: string | null): number {
		const months = CYCLE_MONTHS[cycle ?? 'monthly'] ?? 1;
		if (months === 0 || !amount) return 0;
		return amount / months;
	}

	function computeMRR(accounts: Account[]): number {
		return accounts.reduce((s, a) => s + toMonthlyCents(a.recurringAmount, a.billingCycle), 0);
	}

	type Client = { id: string; name: string; email: string | null; cui: string | null };

	function filterAccounts(items: Account[], q: string, onlyUnassigned: boolean): Account[] {
		let out = items;
		if (onlyUnassigned) out = out.filter((a) => !a.clientId);
		const query = q.trim().toLowerCase();
		if (!query) return out;
		return out.filter(
			(a) =>
				(a.clientName ?? '').toLowerCase().includes(query) ||
				(a.clientBusinessName ?? '').toLowerCase().includes(query) ||
				(a.clientEmail ?? '').toLowerCase().includes(query) ||
				(a.clientCui ?? '').toLowerCase().includes(query) ||
				(a.domain ?? '').toLowerCase().includes(query) ||
				(a.daUsername ?? '').toLowerCase().includes(query)
		);
	}

	type Group = {
		clientId: string | null;
		clientName: string;
		clientBusinessName: string | null;
		clientEmail: string | null;
		clientCui: string | null;
		accounts: Account[];
		mrr: number;
	};

	function groupAccounts(items: Account[]): Group[] {
		const map = new Map<string, Group>();
		for (const a of items) {
			const key = a.clientId ?? '__unassigned__';
			if (!map.has(key)) {
				map.set(key, {
					clientId: a.clientId,
					clientName: a.clientId ? a.clientName ?? `Client #${key.slice(0, 6)}` : 'Neasignat',
					clientBusinessName: a.clientBusinessName,
					clientEmail: a.clientEmail,
					clientCui: a.clientCui,
					accounts: [],
					mrr: 0
				});
			}
			const g = map.get(key)!;
			g.accounts.push(a);
			// Only active accounts contribute to MRR (suspended/terminated don't pay)
			if (a.status === 'active') {
				g.mrr += toMonthlyCents(a.recurringAmount, a.billingCycle);
			}
		}
		return Array.from(map.values()).sort((a, b) => {
			if (!a.clientId && b.clientId) return -1;
			if (a.clientId && !b.clientId) return 1;
			return b.accounts.length - a.accounts.length;
		});
	}

	async function assignClient(accountId: string, newClientId: string | null) {
		try {
			await updateHostingAccountClient({ accountId, clientId: newClientId });
			toast.success(newClientId ? 'Client asignat' : 'Asignare ștearsă');
			refresh();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare asignare');
		}
	}

	let bulkSyncing = $state(false);

	async function bulkSync() {
		if (bulkSyncing) return;
		bulkSyncing = true;
		const toastId = toast.loading('Se sincronizează toate conturile din DA... (poate dura ~10-30 sec)');
		try {
			const result = await syncAllHostingAccounts({});
			const message =
				result.failed === 0
					? `${result.synced}/${result.total} conturi sincronizate · pachete + domenii addon din DA`
					: `${result.synced}/${result.total} OK · ${result.failed} eșuate (vezi consola)`;
			if (result.failed > 0) {
				console.warn('[bulk-sync] errors:', result.errors);
				toast.warning(message, { id: toastId, duration: 8000 });
			} else {
				toast.success(message, { id: toastId, duration: 5000 });
			}
			refresh();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare bulk sync', { id: toastId });
		} finally {
			bulkSyncing = false;
		}
	}
</script>

{#snippet clientInfoCell(acc: Account)}
	{#if acc.clientId}
		<a
			href="/{tenantSlug}/clients/{acc.clientId}"
			class="text-sm font-semibold text-blue-600 hover:underline">{acc.clientName ?? '—'}</a
		>
		{#if acc.clientBusinessName && acc.clientBusinessName !== acc.clientName}
			<div class="text-xs text-slate-600 dark:text-slate-300">{acc.clientBusinessName}</div>
		{/if}
		{#if acc.clientCui}
			<div class="text-xs text-slate-500">CUI {acc.clientCui}</div>
		{/if}
	{:else}
		<div class="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
			<AlertCircleIcon class="size-3" /> Neasignat
		</div>
	{/if}
{/snippet}

{#snippet clientPickerCell(acc: Account, options: Option[])}
	<div class="w-60">
		<Combobox
			value={acc.clientId ?? ''}
			{options}
			placeholder={acc.clientId ? 'Schimbă…' : 'Alege clientul…'}
			searchPlaceholder="Caută după nume, CUI sau email…"
			onValueChange={(v) =>
				assignClient(acc.id, typeof v === 'string' && v ? v : null)}
		/>
	</div>
{/snippet}

{#snippet daUserCell(acc: Account)}
	<span class="font-mono text-sm text-slate-700 dark:text-slate-200">{acc.daUsername}</span>
{/snippet}

{#snippet domainCell(acc: Account)}
	{@const addons = acc.additionalDomains ?? []}
	<a
		href="/{tenantSlug}/hosting/accounts/{acc.id}"
		class="font-medium text-blue-600 hover:underline">{acc.domain}</a
	>
	{#if addons.length > 0}
		<details class="mt-1 group">
			<summary class="cursor-pointer list-none">
				<span
					class="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 hover:bg-amber-100 dark:bg-amber-950 dark:text-amber-200"
					title="Domenii adiționale pe același cont DA"
				>
					+ {addons.length} domeni{addons.length === 1 ? 'u' : 'i'} adițional{addons.length === 1
						? ''
						: 'e'}
					<span class="text-[9px] group-open:rotate-180 transition-transform">▾</span>
				</span>
			</summary>
			<ul class="mt-1 ml-2 space-y-0.5 border-l border-amber-200 pl-2 text-xs text-slate-600 dark:text-slate-300">
				{#each addons as d}
					<li>{d}</li>
				{/each}
			</ul>
		</details>
	{/if}
{/snippet}

{#snippet packageCell(acc: Account)}
	{@const synced = !!acc.daPackageName}
	{@const name = acc.daPackageName ?? acc.linkedPackageName}
	{#if name}
		<span
			class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium {packageClasses(
				name,
				synced
			)}"
			title={synced
				? 'Pachet sincronizat din DirectAdmin'
				: 'Pachet linkat din produs — apasă Sync toate ca să sincronizezi din DA'}
		>
			{#if !synced}
				<span class="opacity-50">○</span>
			{/if}
			{name}
		</span>
	{:else}
		<span class="text-xs text-slate-400">—</span>
	{/if}
{/snippet}

<div class="space-y-6">
	<div class="flex items-center justify-between gap-4">
		<div>
			<h1 class="text-2xl font-bold">Conturi Hosting</h1>
			<p class="text-slate-500">
				Domeniile importate din WHMCS. Folosește dropdown-ul "Match client" pe fiecare rând ca să
				atașezi contul la clientul CRM corect. Apasă "Sync toate" ca să aduci pachetul + domeniile
				addon din DirectAdmin.
			</p>
		</div>
		<div class="flex shrink-0 gap-2">
			<button
				type="button"
				onclick={bulkSync}
				disabled={bulkSyncing}
				class="inline-flex items-center gap-2 rounded-lg border border-indigo-300 bg-indigo-50 px-4 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50 dark:border-indigo-700 dark:bg-indigo-950 dark:text-indigo-200"
				title="Sincronizează din DA: pachet, domenii addon, disk, bandwidth, etc."
			>
				<RefreshCwIcon class="size-4 {bulkSyncing ? 'animate-spin' : ''}" />
				{bulkSyncing ? 'Se sincronizează…' : 'Sync toate (din DA)'}
			</button>
			<a
				href="/{tenantSlug}/hosting/accounts/new"
				class="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
			>
				<PlusIcon class="size-4" /> Cont nou
			</a>
		</div>
	</div>

	{#await accounts then items}
		{@const filtered = filterAccounts(items as Account[], clientSearch, showOnlyUnassigned)}
		{@const activeFiltered = filtered.filter((a) => a.status === 'active')}
		{@const mrrCents = computeMRR(activeFiltered)}
		{@const allItems = items as Account[]}
		{@const unassignedCount = allItems.filter((a) => !a.clientId).length}
		{@const uniqueClients = new Set(filtered.filter((a) => a.clientId).map((a) => a.clientId)).size}

		<div class="grid grid-cols-2 gap-4 md:grid-cols-6">
			<div class="rounded-xl border bg-white p-4 dark:bg-slate-800">
				<div class="text-xs uppercase text-slate-500">Clienți</div>
				<div class="mt-1 text-2xl font-bold">{uniqueClients}</div>
			</div>
			<div class="rounded-xl border bg-white p-4 dark:bg-slate-800">
				<div class="text-xs uppercase text-slate-500">Conturi</div>
				<div class="mt-1 text-2xl font-bold">{filtered.length}</div>
			</div>
			<div class="rounded-xl border bg-white p-4 dark:bg-slate-800">
				<div class="text-xs uppercase text-slate-500">Active</div>
				<div class="mt-1 text-2xl font-bold text-green-700">{activeFiltered.length}</div>
			</div>
			<button
				type="button"
				onclick={() => (showOnlyUnassigned = !showOnlyUnassigned)}
				class="rounded-xl border bg-white p-4 text-left dark:bg-slate-800 {unassignedCount > 0
					? 'border-red-200 hover:border-red-300'
					: ''} {showOnlyUnassigned ? 'ring-2 ring-red-400' : ''}"
			>
				<div class="text-xs uppercase {unassignedCount > 0 ? 'text-red-700' : 'text-slate-500'}">
					Neasignate{unassignedCount > 0 ? ' (filtru)' : ''}
				</div>
				<div class="mt-1 text-2xl font-bold {unassignedCount > 0 ? 'text-red-700' : ''}">
					{unassignedCount}
				</div>
			</button>
			<div class="rounded-xl border bg-white p-4 dark:bg-slate-800" title="Monthly Recurring Revenue: suma normalizată la o lună din toate conturile active.">
				<div class="text-xs uppercase text-slate-500">MRR (lunar)</div>
				<div class="mt-1 text-2xl font-bold">{formatRON(mrrCents)}</div>
			</div>
			<div class="rounded-xl border bg-white p-4 dark:bg-slate-800" title="Annual Recurring Revenue: MRR × 12.">
				<div class="text-xs uppercase text-slate-500">ARR (anual)</div>
				<div class="mt-1 text-2xl font-bold">{formatRON(mrrCents * 12)}</div>
			</div>
		</div>

		<div class="flex flex-wrap items-center gap-3">
			<div class="relative">
				<SearchIcon class="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
				<input
					type="text"
					placeholder="Caută după client, email, domeniu sau username..."
					bind:value={clientSearch}
					class="w-80 rounded-lg border py-2 pl-10 pr-3 text-sm dark:bg-slate-800"
				/>
			</div>
			<select
				bind:value={statusFilter}
				onchange={refresh}
				class="rounded-lg border px-3 py-2 text-sm dark:bg-slate-800"
			>
				<option value="">Toate statusurile</option>
				<option value="active">Active</option>
				<option value="suspended">Suspendate</option>
				<option value="pending">În așteptare</option>
				<option value="terminated">Terminate</option>
				<option value="cancelled">Anulate</option>
			</select>
			<label class="flex items-center gap-2 text-sm">
				<input type="checkbox" bind:checked={groupByClient} />
				Grupează după client
			</label>
		</div>

		{#await allClients then clients}
			{@const clientList = clients as Client[]}
			{@const clientOptions = [
				{ value: '', label: '— Neasignat —' },
				...clientList.map((c) => ({
					value: c.id,
					label: `${c.name}${c.cui ? ` · CUI ${c.cui}` : ''}${c.email ? ` · ${c.email}` : ''}`
				}))
			] satisfies Option[]}

			{#if filtered.length === 0}
				<div class="rounded-xl border bg-white p-12 text-center text-slate-500 dark:bg-slate-800">
					{clientSearch || showOnlyUnassigned
						? 'Niciun rezultat pentru filtru.'
						: 'Niciun cont hosting.'}
				</div>
			{:else if groupByClient}
				<!-- Grouped: client header card + accounts table inside -->
				<div class="space-y-4">
					{#each groupAccounts(filtered) as g (g.clientId ?? '__unassigned__')}
						<div class="overflow-hidden rounded-xl border bg-white dark:bg-slate-800 {!g.clientId
							? 'border-red-200'
							: ''}">
							<div class="flex items-start justify-between gap-4 border-b bg-slate-50 px-6 py-4 dark:bg-slate-900 {!g.clientId
								? 'bg-red-50 dark:bg-red-950'
								: ''}">
								<div class="min-w-0 flex-1">
									{#if g.clientId}
										<a
											href="/{tenantSlug}/clients/{g.clientId}"
											class="text-base font-semibold text-blue-600 hover:underline">{g.clientName}</a
										>
										<div class="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-600 dark:text-slate-300">
											{#if g.clientBusinessName && g.clientBusinessName !== g.clientName}
												<span class="font-medium">{g.clientBusinessName}</span>
											{/if}
											{#if g.clientCui}<span>CUI {g.clientCui}</span>{/if}
											{#if g.clientEmail}<span>{g.clientEmail}</span>{/if}
											<span>·</span>
											<span>{g.accounts.length} cont{g.accounts.length === 1 ? '' : 'uri'}</span>
										</div>
									{:else}
										<div class="inline-flex items-center gap-1 font-semibold text-red-700">
											<AlertCircleIcon class="size-4" /> Neasignate ({g.accounts.length})
										</div>
										<div class="mt-0.5 text-xs text-red-600">
											Conturi fără client. Folosește dropdown-ul "Match" de pe fiecare rând.
										</div>
									{/if}
								</div>
								<div class="shrink-0 text-right text-sm">
									<div class="font-semibold">{formatRON(g.mrr)}</div>
									<div class="text-xs text-slate-500">MRR (normalizat lunar)</div>
								</div>
							</div>
							<table class="w-full">
								<thead>
									<tr class="border-b bg-white text-xs uppercase text-slate-500 dark:bg-slate-800">
										<th class="px-4 py-2 text-left font-medium">DA user</th>
										<th class="px-4 py-2 text-left font-medium">Domeniu</th>
										<th class="px-4 py-2 text-left font-medium">Pachet</th>
										<th class="px-4 py-2 text-left font-medium">Server</th>
										<th class="px-4 py-2 text-left font-medium">Status</th>
										<th class="px-4 py-2 text-left font-medium">Start</th>
										<th class="px-4 py-2 text-left font-medium">Scadență</th>
										<th class="px-4 py-2 text-right font-medium">Suma</th>
										{#if !g.clientId}
											<th class="px-4 py-2 text-left font-medium">Match</th>
										{/if}
									</tr>
								</thead>
								<tbody class="divide-y">
									{#each g.accounts as acc (acc.id)}
										<tr class="hover:bg-slate-50 dark:hover:bg-slate-700">
											<td class="px-4 py-3 align-top">
												{@render daUserCell(acc)}
											</td>
											<td class="px-4 py-3">
												{@render domainCell(acc)}
											</td>
											<td class="px-4 py-3 align-top">
												{@render packageCell(acc)}
											</td>
											<td class="px-4 py-3 text-sm text-slate-500">{acc.serverName ?? '—'}</td>
											<td class="px-4 py-3">
												<span
													class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium {statusColors[
														acc.status
													] ?? 'bg-slate-100 text-slate-700'}">{acc.status}</span
												>
											</td>
											<td class="px-4 py-3 text-sm text-slate-500 whitespace-nowrap">
												{formatDate(acc.startDate)}
											</td>
											<td class="px-4 py-3 text-sm text-slate-500 whitespace-nowrap">
												{formatDate(acc.nextDueDate)}
											</td>
											<td class="px-4 py-3 text-right text-sm whitespace-nowrap">
												<div class="font-medium">{formatRON(acc.recurringAmount, acc.currency ?? 'RON')}</div>
												<div class="text-xs text-slate-500">{CYCLE_LABEL[acc.billingCycle ?? 'monthly'] ?? ''}</div>
											</td>
											{#if !g.clientId}
												<td class="px-4 py-3">
													{@render clientPickerCell(acc, clientOptions)}
												</td>
											{/if}
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					{/each}
				</div>
			{:else}
				<!-- Flat: each row shows client info + match dropdown + account info -->
				<div class="overflow-hidden rounded-xl border bg-white dark:bg-slate-800">
					<table class="w-full">
						<thead>
							<tr class="border-b bg-slate-50 dark:bg-slate-900">
								<th class="px-4 py-3 text-left text-xs font-medium uppercase text-slate-500">DA user</th>
								<th class="px-4 py-3 text-left text-xs font-medium uppercase text-slate-500">Client</th>
								<th class="px-4 py-3 text-left text-xs font-medium uppercase text-slate-500">Match</th>
								<th class="px-4 py-3 text-left text-xs font-medium uppercase text-slate-500">Domeniu</th>
								<th class="px-4 py-3 text-left text-xs font-medium uppercase text-slate-500">Pachet</th>
								<th class="px-4 py-3 text-left text-xs font-medium uppercase text-slate-500">Server</th>
								<th class="px-4 py-3 text-left text-xs font-medium uppercase text-slate-500">Status</th>
								<th class="px-4 py-3 text-left text-xs font-medium uppercase text-slate-500 whitespace-nowrap"
									>Start</th
								>
								<th class="px-4 py-3 text-left text-xs font-medium uppercase text-slate-500 whitespace-nowrap"
									>Scadență</th
								>
								<th class="px-4 py-3 text-right text-xs font-medium uppercase text-slate-500">Suma</th>
							</tr>
						</thead>
						<tbody class="divide-y">
							{#each filtered as acc (acc.id)}
								<tr class="hover:bg-slate-50 dark:hover:bg-slate-700 {!acc.clientId
									? 'bg-red-50/40 dark:bg-red-950/20'
									: ''}">
									<td class="px-4 py-4 align-top">
										{@render daUserCell(acc)}
									</td>
									<td class="px-4 py-4 w-56 align-top">
										{@render clientInfoCell(acc)}
									</td>
									<td class="px-4 py-4 align-top">
										{@render clientPickerCell(acc, clientOptions)}
									</td>
									<td class="px-4 py-4 align-top">
										{@render domainCell(acc)}
									</td>
									<td class="px-4 py-4 align-top">
										{@render packageCell(acc)}
									</td>
									<td class="px-4 py-4 text-sm text-slate-500 align-top">{acc.serverName ?? '—'}</td>
									<td class="px-4 py-4 align-top">
										<span
											class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium {statusColors[
												acc.status
											] ?? 'bg-slate-100 text-slate-700'}">{acc.status}</span
										>
									</td>
									<td class="px-4 py-4 text-sm text-slate-500 align-top whitespace-nowrap">
										{formatDate(acc.startDate)}
									</td>
									<td class="px-4 py-4 text-sm text-slate-500 align-top whitespace-nowrap">
										{formatDate(acc.nextDueDate)}
									</td>
									<td class="px-4 py-4 text-right text-sm align-top whitespace-nowrap">
										<div class="font-medium">{formatRON(acc.recurringAmount, acc.currency ?? 'RON')}</div>
										<div class="text-xs text-slate-500">{CYCLE_LABEL[acc.billingCycle ?? 'monthly'] ?? ''}</div>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		{/await}
	{/await}
</div>
