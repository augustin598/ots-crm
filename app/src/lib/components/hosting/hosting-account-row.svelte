<script lang="ts">
	import type { AccountInGroup } from '$lib/remotes/hosting-accounts.remote';
	import type { ColumnDef } from './column-manager';
	import {
		formatRON,
		formatDate,
		countdownLabel,
		CYCLE_LABEL,
		STATUS_LABEL,
		STATUS_CHIP,
		INVOICE_STATUS_CHIP,
		PACKAGE_CHIP
	} from './hosting-format';
	import Combobox from '$lib/components/ui/combobox/combobox.svelte';
	import type { Option } from '$lib/components/ui/combobox/combobox-types';
	import GlobeIcon from '@lucide/svelte/icons/globe';
	import RotateCwIcon from '@lucide/svelte/icons/rotate-cw';
	import HandIcon from '@lucide/svelte/icons/hand';
	import CheckCircle2Icon from '@lucide/svelte/icons/check-circle-2';
	import AlertTriangleIcon from '@lucide/svelte/icons/alert-triangle';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import EditIcon from '@lucide/svelte/icons/pencil';
	import MoreHorizontalIcon from '@lucide/svelte/icons/more-horizontal';
	import Checkbox from '$lib/components/ui/checkbox/checkbox.svelte';
	import * as Tooltip from '$lib/components/ui/tooltip';

	type Props = {
		acc: AccountInGroup;
		visibleColumns: ColumnDef[];
		tenantSlug: string;
		showMatchPicker: boolean;
		clientOptions: Option[];
		onassignClient?: (accountId: string, clientId: string | null) => void;
		oneditAccount?: (accountId: string) => void;
	};

	let {
		acc,
		visibleColumns,
		tenantSlug,
		showMatchPicker,
		clientOptions,
		onassignClient,
		oneditAccount
	}: Props = $props();

	const countdown = $derived(countdownLabel(acc.expiresInDays));
	let rowChecked = $state(false);

	// Filter out the primary domain from additional_domains in case sync stored a duplicate.
	const addons = $derived(
		(acc.additionalDomains ?? []).filter(
			(d) => d && d.toLowerCase() !== acc.domain.toLowerCase()
		)
	);

	// Extract PHP version from package name if present (e.g. "Wordpress_PHP82" or via daPackageName)
	function extractPhp(name: string | null): string {
		if (!name) return 'PHP 8.2';
		const m = name.match(/php[_\s-]?(\d)\.?(\d)?/i);
		if (m) return `PHP ${m[1]}.${m[2] ?? '0'}`;
		return 'PHP 8.2';
	}
</script>

<tr class="text-sm hover:bg-slate-50/60 dark:hover:bg-slate-700/40">
	<td class="px-3 py-2.5 align-middle">
		<Checkbox bind:checked={rowChecked} aria-label="Selectează rândul {acc.daUsername}" />
	</td>
	{#each visibleColumns as col (col.key)}
		<td class="px-3 py-2.5 align-middle {col.key === 'suma' ? 'text-right whitespace-nowrap' : ''}">
			{#if col.key === 'user'}
				<span class="font-mono text-[13px] text-slate-700 dark:text-slate-200">{acc.daUsername}</span>
			{:else if col.key === 'domain'}
				<a
					href={`/${tenantSlug}/hosting/accounts/${acc.id}`}
					class="font-medium text-blue-600 hover:underline dark:text-blue-400">{acc.domain}</a
				>
				{#if addons.length > 0}
					<details class="group mt-1">
						<summary class="cursor-pointer list-none">
							<span class="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
								<GlobeIcon class="size-2.5" />
								+ {addons.length} domeni{addons.length === 1 ? 'u' : 'i'} adițional{addons.length === 1 ? '' : 'e'}
							</span>
						</summary>
						<ul class="mt-1 ml-3 space-y-0.5 border-l border-slate-200 pl-2 text-[11px] text-slate-500 dark:border-slate-700 dark:text-slate-400">
							{#each addons as d (d)}
								<li>{d}</li>
							{/each}
						</ul>
					</details>
				{/if}
			{:else if col.key === 'addons'}
				{#if addons.length > 0}
					<span class="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300" title={addons.join('\n')}>
						<GlobeIcon class="size-2.5" /> + {addons.length}
					</span>
				{:else}
					<span class="text-slate-300">—</span>
				{/if}
			{:else if col.key === 'pachet'}
				{#if acc.daPackageName ?? acc.linkedPackageName}
					{@const pkg = acc.daPackageName ?? acc.linkedPackageName!}
					<div>
						<span class="inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium {PACKAGE_CHIP(pkg)}">
							{pkg}
						</span>
						<div class="mt-0.5 text-[10px] text-slate-400">{extractPhp(pkg)}</div>
					</div>
				{:else}
					<span class="text-slate-300">—</span>
				{/if}
			{:else if col.key === 'server'}
				<span class="text-slate-600 dark:text-slate-300">{acc.serverName ?? '—'}</span>
			{:else if col.key === 'ciclu'}
				<div>
					<span class="inline-flex items-center rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-700 dark:bg-slate-700 dark:text-slate-200">
						{CYCLE_LABEL[acc.billingCycle] ?? acc.billingCycle}
					</span>
					<div class="mt-0.5 inline-flex items-center gap-0.5 text-[10px] {acc.autoRenew ? 'text-emerald-600' : 'text-slate-500'}">
						{#if acc.autoRenew}
							<RotateCwIcon class="size-2.5" /> auto-renew
						{:else}
							<HandIcon class="size-2.5" /> manual
						{/if}
					</div>
				</div>
			{:else if col.key === 'start'}
				<span class="whitespace-nowrap text-slate-600 dark:text-slate-300">{formatDate(acc.startDate)}</span>
			{:else if col.key === 'scadenta'}
				<div class="whitespace-nowrap">
					<div class="text-slate-700 dark:text-slate-200">{formatDate(acc.nextDueDate)}</div>
					{#if countdown}
						<div class="text-[11px] font-semibold {acc.expiresInDays !== null && acc.expiresInDays < 0
							? 'text-red-600 dark:text-red-400'
							: acc.expiresInDays !== null && acc.expiresInDays <= 7
								? 'text-red-600 dark:text-red-400'
								: acc.expiresInDays !== null && acc.expiresInDays <= 30
									? 'text-amber-600 dark:text-amber-400'
									: 'text-slate-500'}">
							{countdown}
						</div>
					{/if}
				</div>
			{:else if col.key === 'plata'}
				{#if acc.lastInvoice.status === 'n/a'}
					<span class="text-slate-300">—</span>
				{:else}
					{@const inv = acc.lastInvoice}
					{@const statusChipCls = INVOICE_STATUS_CHIP[inv.status] ?? 'bg-slate-100 text-slate-600'}
					{@const statusLabel = inv.status === 'paid' ? 'Plătit' : inv.status === 'overdue' ? 'Restantă' : inv.status === 'sent' ? 'Trimisă' : inv.status === 'pending' ? 'În așteptare' : inv.status === 'draft' ? 'Ciornă' : inv.status === 'cancelled' ? 'Anulată' : inv.status === 'partially_paid' ? 'Parțial' : inv.status}
					<Tooltip.Root>
						<Tooltip.Trigger>
							<span class="inline-flex cursor-default items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium {statusChipCls}">
								{#if inv.status === 'paid'}
									<CheckCircle2Icon class="size-2.5" />
								{:else if inv.status === 'overdue'}
									<AlertTriangleIcon class="size-2.5" />
								{/if}
								{statusLabel}
							</span>
						</Tooltip.Trigger>
						<Tooltip.Content side="top" sideOffset={6} class="max-w-xs">
							<div class="space-y-1 text-[11px] leading-snug">
								{#if inv.invoiceNumber}
									<div class="font-mono text-[12px] font-semibold text-white">{inv.invoiceNumber}</div>
								{/if}
								{#if inv.date}
									<div class="text-slate-300">Emisă <span class="text-white">{formatDate(inv.date)}</span></div>
								{/if}
								{#if inv.amountCents}
									<div class="text-slate-300">Sumă <span class="text-white tabular-nums">{formatRON(inv.amountCents, acc.currency ?? 'RON')}</span></div>
								{/if}
								{#if inv.status === 'overdue' && inv.daysOverdue !== undefined}
									<div class="text-red-300">Restant de {inv.daysOverdue} zile</div>
								{/if}
								{#if inv.matchedVia === 'fallback'}
									<div class="border-t border-slate-700 pt-1 text-[10px] italic text-amber-300">Asociere aproximativă (sumă + dată)</div>
								{:else if inv.matchedVia === 'domain'}
									<div class="border-t border-slate-700 pt-1 text-[10px] italic text-slate-400">Asociat după domeniu în descriere</div>
								{/if}
							</div>
						</Tooltip.Content>
					</Tooltip.Root>
				{/if}
			{:else if col.key === 'status'}
				<span class="inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium {STATUS_CHIP[acc.status] ?? 'bg-slate-100 text-slate-600'}">
					{STATUS_LABEL[acc.status] ?? acc.status}
				</span>
			{:else if col.key === 'suma'}
				{@const faded = acc.status === 'terminated' || acc.status === 'cancelled'}
				<div class="font-semibold {faded ? 'text-slate-400 dark:text-slate-500' : 'text-slate-900 dark:text-slate-100'}">{formatRON(acc.recurringAmount, acc.currency ?? 'RON')}</div>
				<div class="text-[10px] {faded ? 'text-slate-300' : 'text-slate-400'}">/{(CYCLE_LABEL[acc.billingCycle] ?? '').toLowerCase().replace('lunar', 'lună').replace('anual', 'an').replace('trimestrial', 'trim').replace('semestrial', '6 luni').replace('bianual', '2 ani').replace('trianual', '3 ani').replace('one-time', 'unic')}</div>
			{/if}
		</td>
	{/each}
	{#if showMatchPicker}
		<td class="px-3 py-2.5 align-middle">
			<div class="w-56">
				<Combobox
					value=""
					options={clientOptions}
					placeholder="Alege clientul…"
					searchPlaceholder="Caută…"
					onValueChange={(v: number | string | undefined) =>
						onassignClient?.(acc.id, typeof v === 'string' && v ? v : null)}
				/>
			</div>
		</td>
	{/if}
	<td class="px-3 py-2.5 align-middle text-right whitespace-nowrap">
		<div class="inline-flex items-center gap-1">
			<a
				href={`/${tenantSlug}/hosting/accounts/${acc.id}`}
				aria-label="Vezi detalii"
				title="Vezi detalii"
				class="inline-flex size-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
			>
				<ExternalLinkIcon class="size-3.5" />
			</a>
			<button
				type="button"
				onclick={() => oneditAccount?.(acc.id)}
				aria-label="Editează"
				title="Editează"
				class="inline-flex size-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
			>
				<EditIcon class="size-3.5" />
			</button>
			<button
				type="button"
				aria-label="Mai multe"
				title="Mai multe"
				class="inline-flex size-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
			>
				<MoreHorizontalIcon class="size-3.5" />
			</button>
		</div>
	</td>
</tr>
