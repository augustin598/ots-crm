<script lang="ts">
	import { page } from '$app/state';
	import { getHostingAccounts } from '$lib/remotes/hosting-accounts.remote';
	import { getDAServers } from '$lib/remotes/da-servers.remote';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import ServerIcon from '@lucide/svelte/icons/server';

	const tenantSlug = $derived(page.params.tenant);

	let statusFilter = $state('');
	const accounts = $derived(getHostingAccounts({ status: statusFilter || undefined, limit: 100 }));
	const servers = getDAServers();

	const statusColors: Record<string, string> = {
		pending: 'bg-yellow-100 text-yellow-700',
		active: 'bg-green-100 text-green-700',
		suspended: 'bg-orange-100 text-orange-700',
		terminated: 'bg-red-100 text-red-700',
		cancelled: 'bg-slate-100 text-slate-600'
	};

	function formatRON(cents: number | null | undefined, currency = 'RON') {
		const n = (cents ?? 0) / 100;
		return new Intl.NumberFormat('ro-RO', { style: 'currency', currency }).format(n);
	}

	function formatDate(d: string | null | undefined) {
		if (!d) return '—';
		try {
			return new Date(d).toLocaleDateString('ro-RO');
		} catch {
			return d;
		}
	}
</script>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<div>
			<h1 class="text-2xl font-bold">Hosting</h1>
			<p class="text-slate-500">Managementul conturilor de hosting DirectAdmin</p>
		</div>
		<div class="flex gap-2">
			<a
				href="/{tenantSlug}/hosting/servers"
				class="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300"
			>
				<ServerIcon class="size-4" /> Servere
			</a>
			<a
				href="/{tenantSlug}/hosting/accounts/new"
				class="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
			>
				<PlusIcon class="size-4" /> Cont nou
			</a>
		</div>
	</div>

	{#await servers then serverList}
		{#if serverList.length > 0}
			<div class="grid grid-cols-1 gap-4 md:grid-cols-3">
				{#each serverList as srv (srv.id)}
					<a
						href="/{tenantSlug}/hosting/servers/{srv.id}"
						class="flex items-center gap-3 rounded-xl border bg-white p-4 hover:border-blue-300 dark:bg-slate-800"
					>
						<div class="h-3 w-3 rounded-full {srv.isActive && !srv.lastError ? 'bg-green-500' : 'bg-red-500'}"></div>
						<div class="min-w-0 flex-1">
							<div class="truncate text-sm font-medium">{srv.name}</div>
							<div class="truncate text-xs text-slate-500">{srv.hostname}:{srv.port}</div>
						</div>
						<ServerIcon class="size-4 shrink-0 text-slate-400" />
					</a>
				{/each}
			</div>
		{/if}
	{/await}

	<div class="flex gap-3">
		<select
			bind:value={statusFilter}
			class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
		>
			<option value="">Toate statusurile</option>
			<option value="active">Active</option>
			<option value="suspended">Suspendate</option>
			<option value="terminated">Terminate</option>
			<option value="pending">În așteptare</option>
		</select>
	</div>

	<div class="overflow-hidden rounded-xl border bg-white dark:bg-slate-800">
		{#await accounts}
			<div class="p-8 text-center text-slate-500">Se încarcă...</div>
		{:then items}
			{#if items.length === 0}
				<div class="p-12 text-center">
					<ServerIcon class="mx-auto mb-3 size-10 text-slate-300" />
					<p class="text-slate-500">Niciun cont de hosting</p>
					<a
						href="/{tenantSlug}/hosting/accounts/new"
						class="mt-3 inline-flex items-center gap-1 text-sm text-blue-600 hover:underline"
					>
						<PlusIcon class="size-3" /> Adaugă primul cont
					</a>
				</div>
			{:else}
				<table class="w-full">
					<thead>
						<tr class="border-b bg-slate-50 dark:bg-slate-900">
							<th class="px-6 py-3 text-left text-xs font-medium uppercase text-slate-500">Domeniu</th>
							<th class="px-6 py-3 text-left text-xs font-medium uppercase text-slate-500">Client</th>
							<th class="px-6 py-3 text-left text-xs font-medium uppercase text-slate-500">Server</th>
							<th class="px-6 py-3 text-left text-xs font-medium uppercase text-slate-500">Status</th>
							<th class="px-6 py-3 text-left text-xs font-medium uppercase text-slate-500">Scadență</th>
							<th class="px-6 py-3 text-right text-xs font-medium uppercase text-slate-500">Suma</th>
						</tr>
					</thead>
					<tbody class="divide-y">
						{#each items as acc (acc.id)}
							<tr class="hover:bg-slate-50 dark:hover:bg-slate-700">
								<td class="px-6 py-4">
									<a
										href="/{tenantSlug}/hosting/accounts/{acc.id}"
										class="font-medium text-blue-600 hover:underline">{acc.domain}</a
									>
									<div class="text-xs text-slate-500">
										{acc.daUsername}@{acc.serverHostname}
									</div>
								</td>
								<td class="px-6 py-4 text-sm">{acc.clientName ?? '—'}</td>
								<td class="px-6 py-4 text-sm text-slate-500">{acc.serverName ?? '—'}</td>
								<td class="px-6 py-4">
									<span
										class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium {statusColors[
											acc.status
										] ?? 'bg-slate-100 text-slate-700'}">{acc.status}</span
									>
								</td>
								<td class="px-6 py-4 text-sm text-slate-500">{formatDate(acc.nextDueDate)}</td>
								<td class="px-6 py-4 text-right text-sm font-medium">
									{formatRON(acc.recurringAmount, acc.currency ?? 'RON')}/lună
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		{/await}
	</div>
</div>
