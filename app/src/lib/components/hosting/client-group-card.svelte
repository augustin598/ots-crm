<script lang="ts">
	import type { ClientGroup } from '$lib/remotes/hosting-accounts.remote';
	import type { ColumnDef } from './column-manager';
	import type { Option } from '$lib/components/ui/combobox/combobox-types';
	import {
		formatRON,
		clientSinceLabel,
		groupEdgeColor,
		statusMixSegments,
		countdownLabel
	} from './hosting-format';
	import AlertCircleIcon from '@lucide/svelte/icons/alert-circle';
	import CrownIcon from '@lucide/svelte/icons/crown';
	import ShieldAlertIcon from '@lucide/svelte/icons/shield-alert';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import MailIcon from '@lucide/svelte/icons/mail';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import RotateCwIcon from '@lucide/svelte/icons/rotate-cw';
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
	const since = $derived(clientSinceLabel(group.client.clientSince));
	const nextCountdown = $derived(countdownLabel(group.totals.nextExpiry?.days ?? null));
</script>

<div
	class="overflow-hidden rounded-xl border-l-4 border-y border-r bg-white dark:bg-slate-800 {edgeColorClass} {!group.clientId
		? 'border-y-red-200 border-r-red-200'
		: ''}"
>
	<div
		class="flex flex-wrap items-start justify-between gap-4 border-b px-6 py-4 {!group.clientId
			? 'bg-red-50 dark:bg-red-950'
			: 'bg-slate-50 dark:bg-slate-900'}"
	>
		<div class="min-w-0 flex-1 space-y-2">
			<div class="flex flex-wrap items-center gap-2">
				{#if group.clientId}
					<a
						href={`/${tenantSlug}/clients/${group.clientId}`}
						class="text-base font-semibold text-blue-600 hover:underline">{group.client.name}</a
					>
					{#if group.client.tier === 'vip'}
						<span
							class="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-200"
						>
							<CrownIcon class="size-3" /> VIP
						</span>
					{:else if group.client.tier === 'watch'}
						<span
							class="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-800 dark:bg-red-950 dark:text-red-200"
						>
							<ShieldAlertIcon class="size-3" /> LA RISC
						</span>
					{/if}
				{:else}
					<div class="inline-flex items-center gap-1 font-semibold text-red-700">
						<AlertCircleIcon class="size-4" /> Neasignate ({group.accounts.length})
					</div>
				{/if}
			</div>

			{#if group.clientId}
				<div
					class="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-600 dark:text-slate-300"
				>
					{#if group.client.businessName && group.client.businessName !== group.client.name}
						<span class="font-medium">{group.client.businessName}</span>
					{/if}
					{#if group.client.cui}<span>CUI {group.client.cui}</span>{/if}
					{#if group.client.email}<span>{group.client.email}</span>{/if}
					{#if since}
						<span class="inline-flex items-center gap-1">
							<CalendarIcon class="size-3" /> {since}
						</span>
					{/if}
				</div>
			{:else}
				<div class="text-xs text-red-600">
					Conturi fără client. Folosește dropdown-ul de pe fiecare rând.
				</div>
			{/if}

			<div
				class="flex flex-wrap items-center gap-3 pt-1 text-xs text-slate-600 dark:text-slate-300"
			>
				<span>
					<span class="font-semibold text-slate-900 dark:text-slate-100"
						>{group.totals.count}</span
					>
					cont{group.totals.count === 1 ? '' : 'uri'}
				</span>
				{#if group.totals.addonCount > 0}
					<span>
						+ <span class="font-semibold text-slate-900 dark:text-slate-100"
							>{group.totals.addonCount}</span
						>
						addon{group.totals.addonCount === 1 ? '' : 's'}
					</span>
				{/if}
				{#if segments.length > 0}
					<div
						class="ml-1 flex h-2 w-32 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"
						title={Object.entries(group.totals.byStatus)
							.map(([k, v]) => `${k}: ${v}`)
							.join(' · ')}
					>
						{#each segments as s (s.status)}
							<div class={s.cls} style:width={`${s.pct}%`}></div>
						{/each}
					</div>
				{/if}
			</div>
		</div>

		<div class="shrink-0 space-y-1.5 text-right text-sm">
			{#if group.clientId && group.client.ltvCents > 0}
				<div>
					<div class="text-xs uppercase text-slate-500">LTV</div>
					<div
						class="text-base font-bold text-slate-900 dark:text-slate-100"
						title="Total spend (toate facturile plătite)"
					>
						{formatRON(group.client.ltvCents)}
					</div>
				</div>
			{/if}
			<div class="flex items-baseline justify-end gap-3">
				<div>
					<div class="text-[10px] uppercase text-slate-500">MRR</div>
					<div class="font-semibold">{formatRON(group.totals.mrrCents)}</div>
				</div>
				<div>
					<div class="text-[10px] uppercase text-slate-500">ARR</div>
					<div class="font-semibold">{formatRON(group.totals.arrCents)}</div>
				</div>
			</div>
			{#if nextCountdown}
				<div
					class="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-200"
				>
					<CalendarIcon class="size-3" /> Următoarea scadență · {nextCountdown}
				</div>
			{/if}
			{#if group.totals.overdueCount > 0}
				<div
					class="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-800 dark:bg-red-950 dark:text-red-200"
				>
					<AlertCircleIcon class="size-3" />
					{group.totals.overdueCount} factur{group.totals.overdueCount === 1 ? 'ă' : 'i'} restant{group
						.totals.overdueCount === 1
						? 'ă'
						: 'e'}
					{#if group.totals.oldestOverdue}
						· {group.totals.oldestOverdue.daysOverdue} z.
					{/if}
				</div>
			{/if}

			{#if group.clientId}
				<div class="flex flex-wrap justify-end gap-1 pt-1">
					<a
						href={`/${tenantSlug}/clients/${group.clientId}#emails`}
						class="inline-flex items-center gap-1 rounded-md border bg-white px-2 py-1 text-[11px] hover:bg-slate-50 dark:bg-slate-800 dark:hover:bg-slate-700"
						title="Trimite email"
					>
						<MailIcon class="size-3" /> Email
					</a>
					<a
						href={`/${tenantSlug}/invoices/new?clientId=${group.clientId}`}
						class="inline-flex items-center gap-1 rounded-md border bg-white px-2 py-1 text-[11px] hover:bg-slate-50 dark:bg-slate-800 dark:hover:bg-slate-700"
						title="Factură nouă"
					>
						<FileTextIcon class="size-3" /> Factură
					</a>
					<a
						href={`/${tenantSlug}/clients/${group.clientId}#hosting`}
						class="inline-flex items-center gap-1 rounded-md border bg-white px-2 py-1 text-[11px] hover:bg-slate-50 dark:bg-slate-800 dark:hover:bg-slate-700"
						title="Reînnoiește"
					>
						<RotateCwIcon class="size-3" /> Renew
					</a>
				</div>
			{/if}
		</div>
	</div>

	<table class="w-full">
		<thead>
			<tr class="border-b bg-white text-xs uppercase text-slate-500 dark:bg-slate-800">
				{#each visibleColumns as col (col.key)}
					<th class="px-4 py-2 font-medium {col.key === 'suma' ? 'text-right' : 'text-left'}"
						>{col.label}</th
					>
				{/each}
				{#if !group.clientId}
					<th class="px-4 py-2 text-left font-medium">Match</th>
				{/if}
			</tr>
		</thead>
		<tbody class="divide-y">
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
