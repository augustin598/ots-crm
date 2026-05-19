<script lang="ts">
	import type { AccountInGroup } from '$lib/remotes/hosting-accounts.remote';
	import type { ColumnDef } from './column-manager';
	import {
		formatRON,
		formatDate,
		countdownLabel,
		CYCLE_LABEL,
		STATUS_COLORS,
		INVOICE_STATUS_COLORS
	} from './hosting-format';
	import Combobox from '$lib/components/ui/combobox/combobox.svelte';
	import type { Option } from '$lib/components/ui/combobox/combobox-types';
	import CheckIcon from '@lucide/svelte/icons/check';
	import XIcon from '@lucide/svelte/icons/x';

	type Props = {
		acc: AccountInGroup;
		visibleColumns: ColumnDef[];
		tenantSlug: string;
		showMatchPicker: boolean;
		clientOptions: Option[];
		onassignClient?: (accountId: string, clientId: string | null) => void;
	};

	let {
		acc,
		visibleColumns,
		tenantSlug,
		showMatchPicker,
		clientOptions,
		onassignClient
	}: Props = $props();

	const countdown = $derived(countdownLabel(acc.expiresInDays));
</script>

<tr class="hover:bg-slate-50 dark:hover:bg-slate-700">
	{#each visibleColumns as col (col.key)}
		<td
			class="px-4 py-3 align-top text-sm {col.key === 'suma' ? 'text-right whitespace-nowrap' : ''}"
		>
			{#if col.key === 'user'}
				<span class="font-mono text-slate-700 dark:text-slate-200">{acc.daUsername}</span>
			{:else if col.key === 'domain'}
				<a
					href={`/${tenantSlug}/hosting/accounts/${acc.id}`}
					class="font-medium text-blue-600 hover:underline">{acc.domain}</a
				>
				{#if (acc.additionalDomains?.length ?? 0) > 0}
					<details class="group mt-1">
						<summary class="cursor-pointer list-none">
							<span
								class="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 hover:bg-amber-100 dark:bg-amber-950 dark:text-amber-200"
							>
								+ {acc.additionalDomains!.length} domeni{acc.additionalDomains!.length === 1
									? 'u'
									: 'i'}
								<span class="text-[9px] transition-transform group-open:rotate-180">▾</span>
							</span>
						</summary>
						<ul
							class="mt-1 ml-2 space-y-0.5 border-l border-amber-200 pl-2 text-xs text-slate-600 dark:text-slate-300"
						>
							{#each acc.additionalDomains ?? [] as d (d)}
								<li>{d}</li>
							{/each}
						</ul>
					</details>
				{/if}
			{:else if col.key === 'addons'}
				{#if (acc.additionalDomains?.length ?? 0) > 0}
					<span
						class="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-200"
						title={acc.additionalDomains!.join('\n')}
					>
						+ {acc.additionalDomains!.length}
					</span>
				{:else}
					<span class="text-xs text-slate-400">—</span>
				{/if}
			{:else if col.key === 'pachet'}
				{#if acc.daPackageName ?? acc.linkedPackageName}
					<span
						class="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
					>
						{acc.daPackageName ?? acc.linkedPackageName}
					</span>
				{:else}
					<span class="text-xs text-slate-400">—</span>
				{/if}
			{:else if col.key === 'server'}
				<span class="text-slate-500">{acc.serverName ?? '—'}</span>
			{:else if col.key === 'ciclu'}
				<div class="flex items-center gap-1">
					<span
						class="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-700 dark:bg-slate-700 dark:text-slate-200"
					>
						{CYCLE_LABEL[acc.billingCycle] ?? acc.billingCycle}
					</span>
					{#if acc.autoRenew}
						<span
							class="inline-flex items-center gap-0.5 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200"
							title="Auto-renew activ"
						>
							<CheckIcon class="size-3" /> auto
						</span>
					{:else}
						<span
							class="inline-flex items-center gap-0.5 rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 dark:bg-red-950 dark:text-red-200"
							title="Auto-renew dezactivat"
						>
							<XIcon class="size-3" /> manual
						</span>
					{/if}
				</div>
			{:else if col.key === 'start'}
				<span class="whitespace-nowrap text-slate-500">{formatDate(acc.startDate)}</span>
			{:else if col.key === 'scadenta'}
				<div class="whitespace-nowrap">
					<span class="text-slate-500">{formatDate(acc.nextDueDate)}</span>
					{#if countdown}
						<div
							class="text-[11px] font-medium {acc.expiresInDays !== null && acc.expiresInDays < 0
								? 'text-red-600'
								: acc.expiresInDays !== null && acc.expiresInDays <= 7
									? 'text-amber-600'
									: 'text-slate-500'}"
						>
							{countdown}
						</div>
					{/if}
				</div>
			{:else if col.key === 'plata'}
				{#if acc.lastInvoice.status === 'n/a'}
					<span class="text-xs text-slate-400">fără factură</span>
				{:else}
					<div class="space-y-0.5">
						<span
							class="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium {INVOICE_STATUS_COLORS[
								acc.lastInvoice.status
							] ?? 'bg-slate-100 text-slate-600'}"
						>
							{acc.lastInvoice.status}
							{#if acc.lastInvoice.status === 'overdue' && acc.lastInvoice.daysOverdue !== undefined}
								· +{acc.lastInvoice.daysOverdue} z.
							{/if}
						</span>
						{#if acc.lastInvoice.date}
							<div class="text-[11px] text-slate-500">
								{formatDate(acc.lastInvoice.date)} · {formatRON(acc.lastInvoice.amountCents)}
							</div>
						{/if}
					</div>
				{/if}
			{:else if col.key === 'status'}
				<span
					class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium {STATUS_COLORS[
						acc.status
					] ?? 'bg-slate-100 text-slate-700'}"
				>
					{acc.status}
				</span>
			{:else if col.key === 'suma'}
				<div class="font-medium">{formatRON(acc.recurringAmount, acc.currency ?? 'RON')}</div>
				<div class="text-xs text-slate-500">{CYCLE_LABEL[acc.billingCycle] ?? ''}</div>
			{/if}
		</td>
	{/each}
	{#if showMatchPicker}
		<td class="px-4 py-3 align-top">
			<div class="w-60">
				<Combobox
					value=""
					options={clientOptions}
					placeholder="Alege clientul…"
					searchPlaceholder="Caută după nume, CUI sau email…"
					onValueChange={(v: number | string | undefined) =>
						onassignClient?.(acc.id, typeof v === 'string' && v ? v : null)}
				/>
			</div>
		</td>
	{/if}
</tr>
