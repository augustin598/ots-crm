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
	let rowChecked = $state(false);

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
				{#if (acc.additionalDomains?.length ?? 0) > 0}
					<details class="group mt-1">
						<summary class="cursor-pointer list-none">
							<span class="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
								<GlobeIcon class="size-2.5" />
								+ {acc.additionalDomains!.length} domeni{acc.additionalDomains!.length === 1 ? 'u' : 'i'} adițional{acc.additionalDomains!.length === 1 ? '' : 'e'}
							</span>
						</summary>
						<ul class="mt-1 ml-3 space-y-0.5 border-l border-slate-200 pl-2 text-[11px] text-slate-500 dark:border-slate-700 dark:text-slate-400">
							{#each acc.additionalDomains ?? [] as d (d)}
								<li>{d}</li>
							{/each}
						</ul>
					</details>
				{/if}
			{:else if col.key === 'addons'}
				{#if (acc.additionalDomains?.length ?? 0) > 0}
					<span class="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300" title={acc.additionalDomains!.join('\n')}>
						<GlobeIcon class="size-2.5" /> + {acc.additionalDomains!.length}
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
				{:else if acc.lastInvoice.status === 'paid'}
					<div>
						<span class="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium {INVOICE_STATUS_CHIP[acc.lastInvoice.status]}">
							<CheckCircle2Icon class="size-2.5" /> Plătit
						</span>
						{#if acc.lastInvoice.date}
							<div class="mt-0.5 text-[10px] text-slate-400">{formatDate(acc.lastInvoice.date)}</div>
						{/if}
					</div>
				{:else if acc.lastInvoice.status === 'overdue'}
					<div>
						<span class="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium {INVOICE_STATUS_CHIP[acc.lastInvoice.status]}">
							<AlertTriangleIcon class="size-2.5" /> Restant{#if acc.lastInvoice.daysOverdue !== undefined}ă{/if}
						</span>
						{#if acc.lastInvoice.daysOverdue !== undefined}
							<div class="mt-0.5 text-[10px] text-red-500">restant de {acc.lastInvoice.daysOverdue} z</div>
						{/if}
					</div>
				{:else}
					<div>
						<span class="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium {INVOICE_STATUS_CHIP[acc.lastInvoice.status] ?? 'bg-slate-100 text-slate-600'}">
							{acc.lastInvoice.status}
						</span>
						{#if acc.lastInvoice.date}
							<div class="mt-0.5 text-[10px] text-slate-400">{formatDate(acc.lastInvoice.date)}</div>
						{/if}
					</div>
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
			<a
				href={`/${tenantSlug}/hosting/accounts/${acc.id}`}
				aria-label="Editează"
				title="Editează"
				class="inline-flex size-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
			>
				<EditIcon class="size-3.5" />
			</a>
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
