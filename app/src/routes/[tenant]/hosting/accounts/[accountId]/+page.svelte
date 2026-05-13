<script lang="ts">
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import {
		getHostingAccount,
		suspendHostingAccount,
		unsuspendHostingAccount,
		terminateHostingAccount,
		syncAccountStats
	} from '$lib/remotes/hosting-accounts.remote';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';

	const tenantSlug = $derived(page.params.tenant);
	const accountId = $derived(page.params.accountId as string);
	let account = $state(getHostingAccount({ id: accountId, withLive: true }));

	function refresh() {
		account = getHostingAccount({ id: accountId, withLive: true });
	}

	async function handleSuspend() {
		const reason = prompt('Motiv suspendare?', 'Suspendat manual');
		if (reason === null) return;
		try {
			await suspendHostingAccount({ id: accountId, reason });
			toast.success('Suspendat');
			refresh();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare');
		}
	}

	async function handleUnsuspend() {
		try {
			await unsuspendHostingAccount(accountId);
			toast.success('Reactivat');
			refresh();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare');
		}
	}

	async function handleTerminate() {
		if (!confirm('SIGUR vrei să termini contul? Va șterge user-ul DA real.')) return;
		try {
			await terminateHostingAccount(accountId);
			toast.success('Cont terminat');
			refresh();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare');
		}
	}

	async function handleSync() {
		try {
			await syncAccountStats(accountId);
			toast.success('Stats sincronizate');
			refresh();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare');
		}
	}
</script>

<div class="space-y-6">
	<a
		href="/{tenantSlug}/hosting/accounts"
		class="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
	>
		<ArrowLeftIcon class="size-4" /> Înapoi
	</a>

	{#await account}
		<div class="text-center text-slate-500">Se încarcă...</div>
	{:then a}
		<div class="flex items-center justify-between">
			<div>
				<h1 class="text-2xl font-bold">{a.domain}</h1>
				<p class="text-slate-500">DA user: {a.daUsername}</p>
			</div>
			<div class="flex gap-2">
				<button
					onclick={handleSync}
					class="rounded-lg border px-3 py-1.5 text-sm hover:bg-slate-50">Sync stats</button
				>
				{#if a.status === 'active'}
					<button
						onclick={handleSuspend}
						class="rounded-lg border border-orange-300 bg-orange-50 px-3 py-1.5 text-sm text-orange-700"
						>Suspendă</button
					>
				{:else if a.status === 'suspended'}
					<button
						onclick={handleUnsuspend}
						class="rounded-lg bg-green-600 px-3 py-1.5 text-sm text-white hover:bg-green-700"
						>Reactivează</button
					>
				{/if}
				{#if a.status !== 'terminated'}
					<button
						onclick={handleTerminate}
						class="rounded-lg border border-red-300 bg-red-50 px-3 py-1.5 text-sm text-red-700"
						>Termină</button
					>
				{/if}
			</div>
		</div>

		<div class="grid grid-cols-2 gap-6 md:grid-cols-4">
			<div class="rounded-xl border bg-white p-4 dark:bg-slate-800">
				<div class="text-xs uppercase text-slate-500">Status</div>
				<div class="mt-1 text-lg font-semibold">{a.status}</div>
				{#if a.suspendReason}
					<div class="mt-1 text-xs text-orange-600">{a.suspendReason}</div>
				{/if}
			</div>
			<div class="rounded-xl border bg-white p-4 dark:bg-slate-800">
				<div class="text-xs uppercase text-slate-500">Disk</div>
				<div class="mt-1 text-lg font-semibold">{a.diskUsage ?? '—'} MB</div>
			</div>
			<div class="rounded-xl border bg-white p-4 dark:bg-slate-800">
				<div class="text-xs uppercase text-slate-500">Bandwidth</div>
				<div class="mt-1 text-lg font-semibold">{a.bandwidthUsage ?? '—'} MB</div>
			</div>
			<div class="rounded-xl border bg-white p-4 dark:bg-slate-800">
				<div class="text-xs uppercase text-slate-500">Email/DB</div>
				<div class="mt-1 text-lg font-semibold">{a.emailCount ?? 0} / {a.dbCount ?? 0}</div>
			</div>
		</div>

		{#if a.liveStats}
			<div class="rounded-xl border bg-white p-6 dark:bg-slate-800">
				<h2 class="mb-3 font-medium">Live stats (DirectAdmin)</h2>
				<pre class="overflow-x-auto rounded bg-slate-50 p-3 text-xs dark:bg-slate-900">{JSON.stringify(
						a.liveStats,
						null,
						2
					)}</pre>
			</div>
		{/if}

		<div class="rounded-xl border bg-white p-6 dark:bg-slate-800">
			<h2 class="mb-3 font-medium">Detalii</h2>
			<dl class="grid grid-cols-2 gap-y-2 text-sm">
				<dt class="text-slate-500">Scadența</dt>
				<dd>{a.nextDueDate ?? '—'}</dd>
				<dt class="text-slate-500">Suma recurentă</dt>
				<dd>{((a.recurringAmount ?? 0) / 100).toFixed(2)} {a.currency}</dd>
				<dt class="text-slate-500">WHMCS service ID</dt>
				<dd>{a.whmcsServiceId ?? '—'}</dd>
				<dt class="text-slate-500">Note</dt>
				<dd class="whitespace-pre-wrap">{a.notes ?? '—'}</dd>
			</dl>
		</div>
	{:catch err}
		<div class="text-red-600">Eroare: {err.message}</div>
	{/await}
</div>
