<script lang="ts">
	import type { ClientGroup } from '$lib/remotes/hosting-accounts.remote';
	import type { ColumnDef } from './column-manager';
	import type { Option } from '$lib/components/ui/combobox/combobox-types';
	import {
		formatRON,
		groupEdgeColor,
		statusMixSegments,
		countdownLabel,
		STATUS_DOT
	} from './hosting-format';
	import AlertTriangleIcon from '@lucide/svelte/icons/alert-triangle';
	import StarIcon from '@lucide/svelte/icons/star';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import MailIcon from '@lucide/svelte/icons/mail';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import MoreVerticalIcon from '@lucide/svelte/icons/more-vertical';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import HostingAccountRow from './hosting-account-row.svelte';

	type Props = {
		group: ClientGroup;
		visibleColumns: ColumnDef[];
		tenantSlug: string;
		onassignClient?: (accountId: string, clientId: string | null) => void;
		clientOptions?: Option[];
	};

	let {
		group,
		visibleColumns,
		tenantSlug,
		onassignClient,
		clientOptions = []
	}: Props = $props();

	const edge = $derived(
		groupEdgeColor({
			overdueCount: group.totals.overdueCount,
			suspendedCount: group.totals.byStatus.suspended ?? 0,
			tier: group.client.tier,
			nextExpiryDays: group.totals.nextExpiry?.days ?? null
		})
	);

	const edgeColorClass = $derived(
		edge === 'red'
			? 'border-l-red-500'
			: edge === 'amber'
				? 'border-l-amber-500'
				: 'border-l-emerald-500'
	);

	const segments = $derived(statusMixSegments(group.totals.byStatus));
	const nextCountdown = $derived(countdownLabel(group.totals.nextExpiry?.days ?? null));

	function clientInitials(name: string): string {
		return name
			.split(/\s+/)
			.filter(Boolean)
			.slice(0, 2)
			.map((w) => w[0]?.toUpperCase() ?? '')
			.join('');
	}

	function yearsSince(iso: string | null): { label: string; years: number } | null {
		if (!iso) return null;
		const d = new Date(iso);
		if (Number.isNaN(d.getTime())) return null;
		const months = ['ian', 'feb', 'mar', 'apr', 'mai', 'iun', 'iul', 'aug', 'sep', 'oct', 'noi', 'dec'];
		const now = new Date();
		const years = now.getFullYear() - d.getFullYear() -
			(now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate()) ? 1 : 0);
		return {
			label: `${months[d.getMonth()]} ${d.getFullYear()}`,
			years
		};
	}

	const since = $derived(yearsSince(group.client.clientSince));

	function formatDateRo(iso: string | null): string {
		if (!iso) return '—';
		const d = new Date(iso);
		if (Number.isNaN(d.getTime())) return '—';
		return d.toLocaleDateString('ro-RO');
	}
</script>

<div
	class="overflow-hidden rounded-xl border-l-4 border-y border-r border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-800 {edgeColorClass} {!group.clientId
		? 'border-y-red-200 border-r-red-200'
		: ''}"
>
	<!-- Group header: 4-column grid (identity / stats / financial / actions) -->
	<div class="grid grid-cols-1 items-start gap-4 border-b border-slate-200 px-5 py-4 dark:border-slate-700 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1.1fr)_minmax(0,1fr)_auto] {!group.clientId ? 'bg-red-50/40 dark:bg-red-950/30' : ''}">
		<!-- Col 1: identity -->
		<div class="flex min-w-0 items-start gap-3">
			<!-- Avatar with chevron -->
			<button
				type="button"
				aria-label="Expandează / restrânge"
				class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-500 text-sm font-bold text-white"
			>
				{group.clientId ? clientInitials(group.client.name) : '?'}
			</button>

			<div class="min-w-0 flex-1 space-y-1">
				<!-- Title + tier badge + chevron -->
				<div class="flex flex-wrap items-center gap-2">
					{#if group.clientId}
						<a
							href={`/${tenantSlug}/clients/${group.clientId}`}
							class="text-[15px] font-semibold text-slate-900 hover:underline dark:text-slate-100">{group.client.name}</a
						>
						{#if group.client.tier === 'vip'}
							<span
								class="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-200"
							>
								<StarIcon class="size-3 fill-current" /> VIP
							</span>
						{:else if group.client.tier === 'watch'}
							<span
								class="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-800 dark:bg-red-950 dark:text-red-200"
							>
								<AlertTriangleIcon class="size-3" /> LA RISC
							</span>
						{/if}
						<ChevronDownIcon class="size-4 text-slate-400" />
					{:else}
						<div class="inline-flex items-center gap-1 text-base font-semibold text-red-700">
							<AlertTriangleIcon class="size-4" /> Conturi neasignate ({group.accounts.length})
						</div>
					{/if}
				</div>

				{#if group.clientId}
					<!-- Subtitle: business name, CUI, email -->
					<div class="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
						{#if group.client.businessName && group.client.businessName !== group.client.name}
							<span>{group.client.businessName}</span>
						{/if}
						{#if group.client.cui}<span>CUI {group.client.cui}</span>{/if}
						{#if group.client.email}<span>{group.client.email}</span>{/if}
					</div>

					<!-- Client since + LTV -->
					<div class="flex flex-wrap items-center gap-x-3 gap-y-0.5 pt-1 text-xs text-slate-500 dark:text-slate-400">
						{#if since}
							<span>Client din <span class="font-medium text-slate-700 dark:text-slate-200">{since.label}</span></span>
							{#if since.years > 0}
								<span>·</span>
								<span><span class="font-medium text-slate-700 dark:text-slate-200">{since.years} an{since.years === 1 ? '' : 'i'}</span></span>
							{/if}
						{/if}
						{#if group.client.ltvCents > 0}
							{#if since}<span>·</span>{/if}
							<span>LTV <span class="font-semibold text-slate-900 dark:text-slate-100">{formatRON(group.client.ltvCents)}</span></span>
						{/if}
					</div>
				{:else}
					<div class="text-xs text-red-600">Folosește dropdown-ul de pe fiecare rând ca să le asignezi.</div>
				{/if}
			</div>
		</div>

		<!-- Col 2: counts + status mix bar -->
		<div class="min-w-0 space-y-1.5">
			<div class="text-sm text-slate-700 dark:text-slate-200">
				<span class="font-semibold">{group.totals.count}</span> conturi hosting
				{#if group.totals.addonCount > 0}
					· <span class="font-semibold">{group.totals.addonCount}</span> domenii adiționale
				{/if}
			</div>
			{#if segments.length > 0}
				<div class="flex h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
					{#each segments as s (s.status)}
						<div class={s.cls} style:width={`${s.pct}%`} title={`${s.status}: ${Math.round(s.pct)}%`}></div>
					{/each}
				</div>
			{/if}
			<div class="flex flex-wrap gap-3 pt-0.5">
				{#if (group.totals.byStatus.active ?? 0) > 0}
					<span class="inline-flex items-center gap-1.5 text-[11px] text-emerald-700 dark:text-emerald-300">
						<span class="size-1.5 rounded-full {STATUS_DOT.active}"></span>
						<span class="font-medium">{group.totals.byStatus.active}</span> active
					</span>
				{/if}
				{#if (group.totals.byStatus.pending ?? 0) > 0}
					<span class="inline-flex items-center gap-1.5 text-[11px] text-amber-700 dark:text-amber-300">
						<span class="size-1.5 rounded-full {STATUS_DOT.pending}"></span>
						<span class="font-medium">{group.totals.byStatus.pending}</span> în aștept.
					</span>
				{/if}
				{#if (group.totals.byStatus.suspended ?? 0) > 0}
					<span class="inline-flex items-center gap-1.5 text-[11px] text-red-700 dark:text-red-300">
						<span class="size-1.5 rounded-full {STATUS_DOT.suspended}"></span>
						<span class="font-medium">{group.totals.byStatus.suspended}</span> suspendate
					</span>
				{/if}
				{#if (group.totals.byStatus.terminated ?? 0) > 0}
					<span class="inline-flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-400">
						<span class="size-1.5 rounded-full {STATUS_DOT.terminated}"></span>
						<span class="font-medium">{group.totals.byStatus.terminated}</span> terminate
					</span>
				{/if}
				{#if (group.totals.byStatus.cancelled ?? 0) > 0}
					<span class="inline-flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
						<span class="size-1.5 rounded-full {STATUS_DOT.cancelled}"></span>
						<span class="font-medium">{group.totals.byStatus.cancelled}</span> anulate
					</span>
				{/if}
			</div>
		</div>

		<!-- Col 3: MRR/ARR + next expiry + overdue (left-aligned) -->
		<div class="min-w-0 space-y-1.5 text-left text-sm">
			<div>
				<div class="text-base font-bold text-slate-900 dark:text-slate-100">{formatRON(group.totals.mrrCents)}<span class="text-xs font-normal text-slate-500">/lună</span></div>
				<div class="text-[11px] text-slate-500">{formatRON(group.totals.arrCents)}/an</div>
			</div>
			{#if nextCountdown}
				<div class="inline-flex items-center gap-1.5 text-[11px] text-amber-700 dark:text-amber-300">
					<CalendarIcon class="size-3.5" />
					Următoarea scadență: <span class="font-semibold">{formatDateRo(group.totals.nextExpiry?.date ?? null)}</span> · {nextCountdown}
				</div>
			{/if}
			{#if group.totals.overdueCount > 0}
				<div class="inline-flex items-center gap-1.5 text-[11px] font-semibold text-red-700 dark:text-red-300">
					<AlertTriangleIcon class="size-3.5" />
					{group.totals.overdueCount} factur{group.totals.overdueCount === 1 ? 'ă' : 'i'} restant{group.totals.overdueCount === 1 ? 'ă' : 'e'}
				</div>
			{/if}
		</div>

		<!-- Col 4: actions -->
		{#if group.clientId}
			<div class="flex flex-col items-end gap-2 lg:items-end">
				<a
					href={`/${tenantSlug}/clients/${group.clientId}`}
					class="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
				>
					<ExternalLinkIcon class="size-3.5" /> Vezi clientul
				</a>
				<div class="flex items-center gap-1.5">
					<a
						href={`/${tenantSlug}/clients/${group.clientId}#emails`}
						aria-label="Email"
						title="Email client"
						class="inline-flex size-7 items-center justify-center rounded-full border border-slate-300 bg-white hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:hover:bg-slate-700"
					>
						<MailIcon class="size-3.5 text-slate-600 dark:text-slate-300" />
					</a>
					<button
						type="button"
						aria-label="Copiază"
						title="Copiază datele clientului"
						class="inline-flex size-7 items-center justify-center rounded-full border border-slate-300 bg-white hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:hover:bg-slate-700"
					>
						<CopyIcon class="size-3.5 text-slate-600 dark:text-slate-300" />
					</button>
					<button
						type="button"
						aria-label="Mai multe"
						title="Mai multe acțiuni"
						class="inline-flex size-7 items-center justify-center rounded-full border border-slate-300 bg-white hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:hover:bg-slate-700"
					>
						<MoreVerticalIcon class="size-3.5 text-slate-600 dark:text-slate-300" />
					</button>
				</div>
			</div>
		{/if}
	</div>

	<!-- Accounts table -->
	<div class="overflow-x-auto">
		<table class="w-full">
			<thead>
				<tr class="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500 dark:border-slate-700 dark:bg-slate-900">
					<th class="w-10 px-3 py-2.5 text-left">
						<input type="checkbox" class="size-3.5 rounded border-slate-300" />
					</th>
					{#each visibleColumns as col (col.key)}
						<th class="px-3 py-2.5 text-left font-medium {col.key === 'suma' ? 'text-right' : ''}"
							>{col.label}</th
						>
					{/each}
					{#if !group.clientId}
						<th class="px-3 py-2.5 text-left font-medium">Match</th>
					{/if}
					<th class="w-20 px-3 py-2.5"></th>
				</tr>
			</thead>
			<tbody class="divide-y divide-slate-100 dark:divide-slate-700">
				{#each group.accounts as acc (acc.id)}
					<HostingAccountRow
						{acc}
						{visibleColumns}
						{tenantSlug}
						showMatchPicker={!group.clientId}
						{clientOptions}
						{onassignClient}
					/>
				{/each}
			</tbody>
		</table>
	</div>
</div>
