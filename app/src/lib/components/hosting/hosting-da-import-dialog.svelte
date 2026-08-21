<script lang="ts">
	import { focusTrap } from '$lib/actions/focus-trap';
	import { SvelteSet } from 'svelte/reactivity';
	import { toast } from 'svelte-sonner';
	import {
		getDiscoveredDaOnlyAccounts,
		importDaOnlyAccounts,
		type DiscoveredDaAccount
	} from '$lib/remotes/hosting-provisioning.remote';
	import { getClients } from '$lib/remotes/clients.remote';
	import Combobox from '$lib/components/ui/combobox/combobox.svelte';
	import type { Option } from '$lib/components/ui/combobox/combobox-types';
	import { SvelteMap } from 'svelte/reactivity';
	import XIcon from '@lucide/svelte/icons/x';
	import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import AlertTriangleIcon from '@lucide/svelte/icons/alert-triangle';
	import DownloadCloudIcon from '@lucide/svelte/icons/download-cloud';

	type Props = {
		onClose: () => void;
		/** Fired after a successful import so the parent can refresh the grouped list. */
		onImported?: () => void;
	};
	let { onClose, onImported }: Props = $props();

	// Discovery query — keyed by no args; refreshed on open to force a live DA scan.
	const discovery = getDiscoveredDaOnlyAccounts({});
	$effect(() => {
		void discovery.refresh();
	});

	// Body scroll lock for the dialog lifetime.
	$effect(() => {
		const previous = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		return () => {
			document.body.style.overflow = previous;
		};
	});

	// Selection keyed by `${daServerId}::${daUsername}`.
	const selected = new SvelteSet<string>();
	/** Client chosen per row, same key as `selected`. Empty = import „Neasignat". */
	const clientByRow = new SvelteMap<string, string>();
	let importing = $state(false);

	// Client list for the picker. Labels carry name + CUI + email, and the
	// combobox filters on the label — so typing a CUI finds the company.
	const clients = getClients();
	const clientOptions = $derived.by<Option[]>(() => {
		const list = clients.current ?? [];
		return [
			{ value: '', label: '— Neasignat —' },
			...list.map((c) => ({
				value: c.id,
				label: `${c.name}${c.cui ? ` · CUI ${c.cui}` : ''}${c.email ? ` · ${c.email}` : ''}`
			}))
		];
	});

	function keyOf(a: DiscoveredDaAccount): string {
		return `${a.daServerId}::${a.daUsername}`;
	}

	function toggle(a: DiscoveredDaAccount): void {
		const k = keyOf(a);
		if (selected.has(k)) selected.delete(k);
		else selected.add(k);
	}

	function toggleAll(list: DiscoveredDaAccount[], on: boolean): void {
		selected.clear();
		if (on) for (const a of list) selected.add(keyOf(a));
	}

	/** Picking a client also ticks the row — choosing a company means "import this". */
	function setClient(a: DiscoveredDaAccount, clientId: string | null): void {
		const k = keyOf(a);
		if (clientId) {
			clientByRow.set(k, clientId);
			selected.add(k);
		} else {
			clientByRow.delete(k);
		}
	}

	function fmtPrice(p: DiscoveredDaAccount['pricePreview']): string {
		if (!p) return '—';
		return `${(p.amountCents / 100).toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${p.currency}`;
	}

	async function importSelected(list: DiscoveredDaAccount[]): Promise<void> {
		if (importing) return;
		const items = list
			.filter((a) => selected.has(keyOf(a)))
			.map((a) => ({
				daServerId: a.daServerId,
				daUsername: a.daUsername,
				clientId: clientByRow.get(keyOf(a)) ?? null
			}));
		if (items.length === 0) {
			toast.warning('Selectează cel puțin un cont.');
			return;
		}
		importing = true;
		const toastId = toast.loading(`Se importă ${items.length} cont${items.length === 1 ? '' : 'uri'} din DA...`);
		try {
			const res = await importDaOnlyAccounts({ items });
			const parts: string[] = [];
			if (res.created) parts.push(`${res.created} importate`);
			if (res.skipped) parts.push(`${res.skipped} existau deja`);
			if (res.failed) parts.push(`${res.failed} eșuate`);
			const msg = parts.join(' · ') || 'Nimic de importat';
			if (res.failed > 0) {
				console.warn('[da-import] errors:', res.results.filter((r) => r.status === 'failed'));
				toast.warning(msg, { id: toastId, duration: 8000 });
			} else {
				toast.success(msg, { id: toastId, duration: 5000 });
			}
			onImported?.();
			onClose();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la import', { id: toastId });
		} finally {
			importing = false;
		}
	}
</script>

<button
	type="button"
	aria-label="Închide"
	class="fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-sm"
	onclick={onClose}
></button>

<div
	role="dialog"
	aria-modal="true"
	aria-labelledby="da-import-dialog-title"
	use:focusTrap={{ onEscape: onClose }}
	class="fixed left-1/2 top-1/2 z-50 flex max-h-[min(92vh,900px)] w-[min(97vw,1400px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-slate-900"
>
	<!-- Header -->
	<div class="flex shrink-0 items-center gap-3 border-b border-slate-200 px-5 py-3.5 dark:border-slate-700">
		<div class="min-w-0 flex-1">
			<div id="da-import-dialog-title" class="text-[15px] font-bold text-slate-900 dark:text-slate-100">
				Import conturi din DirectAdmin
			</div>
			<div class="mt-0.5 text-[12px] text-slate-500">
				Conturi live pe DA care nu au încă rând în CRM. Alege compania pentru fiecare (caută după nume sau CUI); cele lăsate goale intră ca „Neasignat".
			</div>
		</div>
		<button
			type="button"
			onclick={() => void discovery.refresh()}
			class="inline-flex items-center gap-1.5 rounded-md border border-slate-300 px-2.5 py-1.5 text-[12px] font-medium text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
		>
			<RefreshCwIcon class="size-3.5" /> Rescanează
		</button>
		<button
			type="button"
			aria-label="Închide"
			onclick={onClose}
			class="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
		>
			<XIcon class="size-4" />
		</button>
	</div>

	{#await discovery}
		<div class="flex flex-1 items-center justify-center p-16 text-sm text-slate-500">
			<LoaderCircleIcon class="mr-2 size-4 animate-spin" /> Se scanează serverele DirectAdmin…
		</div>
	{:then data}
		{@const list = data.discovered}
		{@const allSelected = list.length > 0 && list.every((a) => selected.has(keyOf(a)))}

		<!-- Server scan summary -->
		{#if data.servers.length > 0}
			<div class="flex flex-wrap gap-2 border-b border-slate-100 bg-slate-50 px-5 py-2.5 dark:border-slate-800 dark:bg-slate-800/40">
				{#each data.servers as s (s.id)}
					<span
						class="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium {s.ok
							? 'bg-white text-slate-600 dark:bg-slate-800 dark:text-slate-300'
							: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300'}"
						title={s.ok
							? `${s.daUserCount ?? 0} conturi pe DA · ${s.daOnlyCount ?? 0} fără rând în CRM${
									(s.adminSkipped ?? 0) > 0
										? ` · ${s.adminSkipped} conturi de administrare DA ignorate`
										: ''
								}`
							: s.error}
					>
						<span class="size-1.5 rounded-full {s.ok ? 'bg-emerald-500' : 'bg-red-500'}"></span>
						{s.name ?? s.hostname}
						{#if s.ok}· {s.daOnlyCount ?? 0} noi / {s.daUserCount ?? 0}{:else}· eroare{/if}
					</span>
					{#if s.ok && (s.unreadable?.length ?? 0) > 0}
						<span
							class="inline-flex items-center gap-1.5 rounded-md bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300"
							title="Conturi DA fără domeniu citibil: {s.unreadable?.join(', ')}"
						>
							<AlertTriangleIcon class="size-3" />
							{s.unreadable?.length} necitite
						</span>
					{/if}
				{/each}
			</div>
		{/if}

		{#if list.length === 0}
			{@const unreadableTotal = data.servers.reduce((n, s) => n + (s.unreadable?.length ?? 0), 0)}
			{@const failedServers = data.servers.filter((s) => !s.ok).length}
			<div class="flex flex-1 flex-col items-center justify-center gap-2 p-16 text-center text-sm text-slate-500">
				<DownloadCloudIcon class="size-6 text-slate-400" />
				{#if failedServers > 0}
					Scanarea a eșuat pe {failedServers}
					{failedServers === 1 ? 'server' : 'servere'} — vezi detaliile de mai sus. Nu putem spune
					dacă mai sunt conturi de importat.
				{:else if unreadableTotal > 0}
					Nimic de importat, dar {unreadableTotal}
					{unreadableTotal === 1 ? 'cont DA nu a putut fi citit' : 'conturi DA nu au putut fi citite'}
					— vezi eticheta portocalie de mai sus.
				{:else}
					Toate conturile de pe DA au deja rând în CRM. Nimic de importat.
				{/if}
			</div>
		{:else}
			<!-- Review table -->
			<div class="min-h-0 flex-1 overflow-auto">
				<table class="w-full border-collapse text-sm">
					<thead class="sticky top-0 z-10 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500 dark:bg-slate-800">
						<tr>
							<th class="w-10 px-4 py-2.5">
								<input
									type="checkbox"
									aria-label="Selectează tot"
									checked={allSelected}
									onchange={(e) => toggleAll(list, e.currentTarget.checked)}
								/>
							</th>
							<th class="px-3 py-2.5">Utilizator DA</th>
							<th class="px-3 py-2.5">Domeniu</th>
							<th class="px-3 py-2.5">Client / Companie</th>
							<th class="px-3 py-2.5">Pachet</th>
							<th class="px-3 py-2.5">Server</th>
							<th class="px-3 py-2.5">Stare</th>
							<th class="whitespace-nowrap px-3 py-2.5 text-right">Preț/ciclu</th>
						</tr>
					</thead>
					<tbody>
						{#each list as a (keyOf(a))}
							{@const checked = selected.has(keyOf(a))}
							<tr
								class="border-t border-slate-100 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50 {checked
									? 'bg-blue-50/50 dark:bg-blue-950/20'
									: ''}"
							>
								<td class="px-4 py-2.5">
									<input
										type="checkbox"
										aria-label="Selectează {a.daUsername}"
										{checked}
										onchange={() => toggle(a)}
									/>
								</td>
								<td class="px-3 py-2.5 font-mono text-[13px] text-slate-700 dark:text-slate-200">{a.daUsername}</td>
								<td class="px-3 py-2.5">
									<div class="font-medium text-slate-800 dark:text-slate-100">{a.primaryDomain}</div>
									{#if a.additionalDomains.length > 0}
										<div class="text-[11px] text-slate-400">+{a.additionalDomains.length} adiționale</div>
									{/if}
								</td>
								<td class="px-3 py-2.5">
									<div class="min-w-[15rem]">
										<Combobox
											value={clientByRow.get(keyOf(a)) ?? ''}
											options={clientOptions}
											placeholder="Alege clientul…"
											searchPlaceholder="Caută după nume sau CUI…"
											onValueChange={(v: number | string | undefined) =>
												setClient(a, typeof v === 'string' && v ? v : null)}
										/>
									</div>
								</td>
								<td class="px-3 py-2.5 text-slate-600 dark:text-slate-300">{a.daPackageName ?? '—'}</td>
								<td class="px-3 py-2.5 text-[12px] text-slate-500">{a.serverName ?? a.serverHostname}</td>
								<td class="px-3 py-2.5">
									{#if a.suspended}
										<span class="inline-flex items-center gap-1 rounded-md bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700 dark:bg-red-950 dark:text-red-300">
											Suspendat
										</span>
									{:else}
										<span class="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
											Activ
										</span>
									{/if}
								</td>
								<td class="whitespace-nowrap px-3 py-2.5 text-right {a.pricePreview ? 'text-slate-700 dark:text-slate-200' : 'text-amber-600'}">
									{fmtPrice(a.pricePreview)}
									{#if !a.pricePreview}
										<div class="text-[10px] text-amber-500">fără produs</div>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>

			<!-- Footer -->
			<div class="flex shrink-0 items-center justify-between gap-3 border-t border-slate-200 px-5 py-3 dark:border-slate-700">
				<div class="text-[12px] text-slate-500">
					{selected.size} din {list.length} selectate
					<span class="text-slate-300"> · </span>
					Rândurile fără companie intră ca „Neasignat"
					<span class="text-slate-300"> · </span>
					Conturile fără preț se importă cu 0 (le stabilești manual).
				</div>
				<div class="flex items-center gap-2">
					<button
						type="button"
						onclick={onClose}
						class="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
					>
						Anulează
					</button>
					<button
						type="button"
						onclick={() => importSelected(list)}
						disabled={importing || selected.size === 0}
						class="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
					>
						{#if importing}
							<LoaderCircleIcon class="size-4 animate-spin" />
						{:else}
							<DownloadCloudIcon class="size-4" />
						{/if}
						Importă {selected.size > 0 ? selected.size : ''}
					</button>
				</div>
			</div>
		{/if}
	{:catch err}
		<div class="flex flex-1 flex-col items-center justify-center gap-2 p-12 text-sm text-red-600">
			<AlertTriangleIcon class="size-5" />
			Eroare la scanare: {err instanceof Error ? err.message : String(err)}
		</div>
	{/await}
</div>
