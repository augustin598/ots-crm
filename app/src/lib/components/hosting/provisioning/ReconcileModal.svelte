<script lang="ts">
	import XIcon from '@lucide/svelte/icons/x';
	import ShieldCheckIcon from '@lucide/svelte/icons/shield-check';
	import ShieldAlertIcon from '@lucide/svelte/icons/shield-alert';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import SearchIcon from '@lucide/svelte/icons/search';

	import SyncStatusBadge from './SyncStatusBadge.svelte';
	import type { DaSyncStatus } from './types';

	type Discrepancy = {
		id: string;
		daUsername: string;
		domain: string;
		crmStatus: string;
		daSyncStatus: string;
		daSyncIssue: string;
	};

	type ReconcileResult = {
		checked: number;
		ok: number;
		orphans: number;
		suspendedOnDa: number;
		activeOnDa: number;
		packageMismatch: number;
		errors: number;
		discrepancies: Discrepancy[];
		startedAt: string;
		finishedAt: string;
	};

	type ReconcileViewState =
		| { kind: 'idle' }
		| { kind: 'running' }
		| { kind: 'done'; result: ReconcileResult }
		| { kind: 'error'; message: string };

	let {
		view,
		onClose
	}: {
		view: ReconcileViewState;
		onClose: () => void;
	} = $props();

	let filter = $state('');

	const filteredDiscrepancies = $derived.by(() => {
		if (view.kind !== 'done') return [] as Discrepancy[];
		const q = filter.trim().toLowerCase();
		if (!q) return view.result.discrepancies;
		return view.result.discrepancies.filter(
			(d) =>
				d.daUsername.toLowerCase().includes(q) ||
				d.domain.toLowerCase().includes(q) ||
				d.daSyncIssue.toLowerCase().includes(q)
		);
	});

	const summaryTiles = $derived.by(() => {
		if (view.kind !== 'done') return [];
		const r = view.result;
		return [
			{ key: 'ok', label: 'Sincronizate', value: r.ok, tone: 'emerald' },
			{ key: 'orphan', label: 'Orfane', value: r.orphans, tone: 'rose' },
			{ key: 'suspended_on_da', label: 'Suspendate pe DA', value: r.suspendedOnDa, tone: 'orange' },
			{ key: 'active_on_da', label: 'Active pe DA', value: r.activeOnDa, tone: 'amber' },
			{ key: 'package_mismatch', label: 'Pachet diferit', value: r.packageMismatch, tone: 'violet' },
			{ key: 'server_error', label: 'Erori DA', value: r.errors, tone: 'slate' }
		];
	});

	const tileToneClass: Record<string, string> = {
		emerald:
			'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-950/30 dark:border-emerald-900/40 dark:text-emerald-300',
		rose: 'bg-rose-50 border-rose-200 text-rose-700 dark:bg-rose-950/30 dark:border-rose-900/40 dark:text-rose-300',
		orange:
			'bg-orange-50 border-orange-200 text-orange-700 dark:bg-orange-950/30 dark:border-orange-900/40 dark:text-orange-300',
		amber:
			'bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-950/30 dark:border-amber-900/40 dark:text-amber-300',
		violet:
			'bg-violet-50 border-violet-200 text-violet-700 dark:bg-violet-950/30 dark:border-violet-900/40 dark:text-violet-300',
		slate:
			'bg-slate-50 border-slate-200 text-slate-700 dark:bg-slate-800/50 dark:border-slate-700 dark:text-slate-300'
	};

	function fmtDuration(startIso: string, endIso: string): string {
		const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
		if (ms < 1000) return `${ms}ms`;
		if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
		return `${(ms / 60_000).toFixed(1)}min`;
	}
</script>

<div
	class="fixed inset-0 z-[90] bg-slate-900/60 backdrop-blur-sm"
	role="button"
	tabindex="-1"
	aria-label="Închide modal"
	onclick={onClose}
	onkeydown={(e) => e.key === 'Escape' && onClose()}
></div>
<div
	class="fixed left-1/2 top-1/2 z-[100] flex w-full max-w-[760px] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-slate-900"
	style="max-height:88vh"
	role="dialog"
	aria-modal="true"
	aria-labelledby="prv-rec-title"
>
	<!-- Header -->
	<div class="flex items-start gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-700">
		<div
			class="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400"
		>
			<ShieldCheckIcon class="h-4 w-4" />
		</div>
		<div class="min-w-0 flex-1">
			<strong
				id="prv-rec-title"
				class="block text-[15px] font-bold text-slate-900 dark:text-slate-100"
			>
				Reconciliere DirectAdmin
			</strong>
			<span class="text-[12px] text-slate-500 dark:text-slate-400">
				Verifică pe DA fiecare cont activ / suspendat / pending și marchează discrepanțele.
			</span>
		</div>
		<button
			type="button"
			class="flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700"
			onclick={onClose}
			aria-label="Închide"
		>
			<XIcon class="h-3.5 w-3.5" />
		</button>
	</div>

	<!-- Body -->
	<div class="flex flex-col overflow-hidden">
		{#if view.kind === 'running'}
			<div class="flex flex-col items-center justify-center gap-3 px-6 py-16">
				<RefreshCwIcon class="h-8 w-8 animate-spin text-blue-500" />
				<div class="text-center">
					<strong class="block text-[13px] text-slate-700 dark:text-slate-200">
						Verific DA pentru toate conturile active + suspendate...
					</strong>
					<span class="mt-1 block text-[11.5px] text-slate-500 dark:text-slate-400">
						Poate dura 1–3 minute, în funcție de câte conturi sunt și de latența serverelor DA.
					</span>
				</div>
			</div>
		{:else if view.kind === 'error'}
			<div class="px-5 py-6">
				<div
					class="flex gap-2.5 rounded-lg border border-rose-200 bg-rose-50 p-3 dark:border-rose-900/40 dark:bg-rose-950/30"
				>
					<ShieldAlertIcon
						class="mt-0.5 h-4 w-4 flex-shrink-0 text-rose-600 dark:text-rose-400"
					/>
					<div class="min-w-0">
						<strong
							class="block text-[12.5px] font-semibold text-rose-900 dark:text-rose-200"
						>
							Reconcilierea a eșuat
						</strong>
						<div class="mt-0.5 break-all text-[11.5px] text-rose-700 dark:text-rose-400">
							{view.message}
						</div>
					</div>
				</div>
			</div>
		{:else if view.kind === 'done'}
			<!-- Sumar -->
			<div class="border-b border-slate-200 px-5 pb-4 pt-4 dark:border-slate-700">
				<div class="mb-2 flex items-center justify-between text-[12.5px] text-slate-600 dark:text-slate-300">
					<span>
						Verificate <strong class="text-slate-900 dark:text-slate-100"
							>{view.result.checked}</strong
						> conturi în
						<strong class="text-slate-900 dark:text-slate-100"
							>{fmtDuration(view.result.startedAt, view.result.finishedAt)}</strong
						>
					</span>
				</div>
				<div class="grid grid-cols-3 gap-2 md:grid-cols-6">
					{#each summaryTiles as t (t.key)}
						<div
							class="rounded-lg border p-2 text-center {tileToneClass[t.tone]}"
						>
							<div class="text-[16px] font-bold tabular-nums">{t.value}</div>
							<div class="text-[10px] font-medium opacity-80">{t.label}</div>
						</div>
					{/each}
				</div>
			</div>

			<!-- Filtru + Listă discrepanțe -->
			{#if view.result.discrepancies.length === 0}
				<div class="px-5 py-10 text-center">
					<div
						class="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-300"
					>
						<ShieldCheckIcon class="h-5 w-5" />
					</div>
					<strong class="text-[13.5px] text-slate-800 dark:text-slate-100">
						Tot e aliniat
					</strong>
					<p class="mt-1 text-[12px] text-slate-500 dark:text-slate-400">
						Toate conturile verificate sunt în sync cu DA.
					</p>
				</div>
			{:else}
				<div class="border-b border-slate-200 px-5 py-3 dark:border-slate-700">
					<div
						class="inline-flex w-full items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-slate-400 dark:border-slate-700 dark:bg-slate-800"
					>
						<SearchIcon class="h-3 w-3" />
						<input
							bind:value={filter}
							placeholder="Caută username, domeniu sau motiv..."
							class="flex-1 bg-transparent text-[12.5px] text-slate-900 outline-none placeholder:text-slate-400 dark:text-slate-100"
						/>
					</div>
				</div>
				<div class="flex-1 overflow-y-auto" style="max-height: 50vh">
					<table class="w-full text-[12px]">
						<thead class="sticky top-0 bg-slate-50 dark:bg-slate-800/80">
							<tr>
								<th
									class="px-3.5 py-2 text-left text-[10.5px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400"
								>
									Cont
								</th>
								<th
									class="px-3.5 py-2 text-left text-[10.5px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400"
								>
									CRM
								</th>
								<th
									class="px-3.5 py-2 text-left text-[10.5px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400"
								>
									Discrepanță
								</th>
							</tr>
						</thead>
						<tbody>
							{#each filteredDiscrepancies as d (d.id)}
								<tr class="border-t border-slate-100 dark:border-slate-800">
									<td class="px-3.5 py-2 align-top">
										<div class="font-mono text-slate-800 dark:text-slate-100">{d.daUsername}</div>
										<div class="font-mono text-[10.5px] text-slate-500 dark:text-slate-400">
											{d.domain}
										</div>
									</td>
									<td class="px-3.5 py-2 align-top">
										<span class="text-slate-700 dark:text-slate-300">{d.crmStatus}</span>
									</td>
									<td class="px-3.5 py-2 align-top">
										<SyncStatusBadge
											status={d.daSyncStatus as DaSyncStatus}
											issue={d.daSyncIssue}
										/>
										<div class="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
											{d.daSyncIssue}
										</div>
									</td>
								</tr>
							{/each}
							{#if filteredDiscrepancies.length === 0}
								<tr>
									<td
										colspan="3"
										class="px-3.5 py-6 text-center text-[12px] text-slate-500 dark:text-slate-400"
									>
										Niciun rezultat pentru „{filter}".
									</td>
								</tr>
							{/if}
						</tbody>
					</table>
				</div>
			{/if}
		{/if}
	</div>

	<!-- Footer -->
	<div
		class="flex items-center gap-2 border-t border-slate-200 bg-slate-50/60 px-5 py-3 dark:border-slate-700 dark:bg-slate-800/40"
	>
		{#if view.kind === 'done'}
			<span class="text-[11.5px] text-slate-500 dark:text-slate-400">
				Discrepanțele rămân marcate pe rânduri cu badge. Fix-urile se fac manual din meniul „⋯"
				de pe fiecare rând.
			</span>
		{/if}
		<div class="flex-1"></div>
		<button
			type="button"
			class="rounded-md bg-slate-900 px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
			onclick={onClose}
		>
			Închide
		</button>
	</div>
</div>
