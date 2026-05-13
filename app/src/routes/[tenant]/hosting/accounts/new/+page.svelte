<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import { getDAServers, getDAServer } from '$lib/remotes/da-servers.remote';
	import { getClients } from '$lib/remotes/clients.remote';
	import { createHostingAccount } from '$lib/remotes/hosting-accounts.remote';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';

	const tenantSlug = $derived(page.params.tenant);

	const clients = getClients();
	const servers = getDAServers();

	let form = $state({
		clientId: '',
		daServerId: '',
		daPackageId: '',
		daUsername: '',
		domain: '',
		password: '',
		recurringAmount: 0,
		currency: 'RON',
		nextDueDate: '',
		notes: ''
	});
	let submitting = $state(false);

	const serverDetail = $derived(form.daServerId ? getDAServer(form.daServerId) : null);

	async function submit() {
		if (!form.clientId || !form.daServerId || !form.daUsername || !form.domain || !form.password) {
			toast.error('Completează câmpurile obligatorii');
			return;
		}
		submitting = true;
		try {
			const result = await createHostingAccount({
				...form,
				recurringAmount: Math.round(form.recurringAmount * 100),
				daPackageId: form.daPackageId || undefined,
				nextDueDate: form.nextDueDate || undefined,
				notes: form.notes || undefined
			});
			toast.success('Cont hosting creat');
			await goto(`/${tenantSlug}/hosting/accounts/${result.id}`);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare creare cont');
		} finally {
			submitting = false;
		}
	}
</script>

<div class="max-w-2xl space-y-6">
	<a
		href="/{tenantSlug}/hosting/accounts"
		class="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
	>
		<ArrowLeftIcon class="size-4" /> Înapoi
	</a>

	<div>
		<h1 class="text-2xl font-bold">Cont hosting nou</h1>
		<p class="text-slate-500">Va crea efectiv user-ul pe serverul DA selectat</p>
	</div>

	<form
		onsubmit={(e) => {
			e.preventDefault();
			submit();
		}}
		class="space-y-4 rounded-xl border bg-white p-6 dark:bg-slate-800"
	>
		<div>
			<label class="mb-1 block text-sm font-medium" for="client">Client *</label>
			{#await clients}
				<select id="client" disabled class="w-full rounded-lg border px-3 py-2"><option>...</option></select>
			{:then list}
				<select
					id="client"
					bind:value={form.clientId}
					required
					class="w-full rounded-lg border px-3 py-2 dark:bg-slate-900"
				>
					<option value="">— alege client —</option>
					{#each list as c (c.id)}
						<option value={c.id}>{c.name}</option>
					{/each}
				</select>
			{/await}
		</div>

		<div>
			<label class="mb-1 block text-sm font-medium" for="server">Server DA *</label>
			{#await servers}
				<select id="server" disabled class="w-full rounded-lg border px-3 py-2"><option>...</option></select>
			{:then list}
				<select
					id="server"
					bind:value={form.daServerId}
					required
					class="w-full rounded-lg border px-3 py-2 dark:bg-slate-900"
				>
					<option value="">— alege server —</option>
					{#each list as s (s.id)}
						<option value={s.id}>{s.name} ({s.hostname})</option>
					{/each}
				</select>
			{/await}
		</div>

		{#if serverDetail}
			{#await serverDetail then s}
				{#if s.packages.length > 0}
					<div>
						<label class="mb-1 block text-sm font-medium" for="package">Pachet DA</label>
						<select
							id="package"
							bind:value={form.daPackageId}
							class="w-full rounded-lg border px-3 py-2 dark:bg-slate-900"
						>
							<option value="">— default —</option>
							{#each s.packages as p (p.id)}
								<option value={p.id}>{p.daName}</option>
							{/each}
						</select>
					</div>
				{/if}
			{/await}
		{/if}

		<div class="grid grid-cols-2 gap-4">
			<div>
				<label class="mb-1 block text-sm font-medium" for="username">Username DA *</label>
				<input
					id="username"
					bind:value={form.daUsername}
					required
					maxlength="20"
					class="w-full rounded-lg border px-3 py-2 dark:bg-slate-900"
				/>
			</div>
			<div>
				<label class="mb-1 block text-sm font-medium" for="domain">Domeniu *</label>
				<input
					id="domain"
					bind:value={form.domain}
					required
					placeholder="example.com"
					class="w-full rounded-lg border px-3 py-2 dark:bg-slate-900"
				/>
			</div>
			<div>
				<label class="mb-1 block text-sm font-medium" for="password">Parolă *</label>
				<input
					id="password"
					type="password"
					bind:value={form.password}
					required
					minlength="8"
					class="w-full rounded-lg border px-3 py-2 dark:bg-slate-900"
				/>
			</div>
			<div>
				<label class="mb-1 block text-sm font-medium" for="amount">Suma recurentă (RON)</label>
				<input
					id="amount"
					type="number"
					min="0"
					step="0.01"
					bind:value={form.recurringAmount}
					class="w-full rounded-lg border px-3 py-2 dark:bg-slate-900"
				/>
			</div>
			<div>
				<label class="mb-1 block text-sm font-medium" for="due">Scadența</label>
				<input
					id="due"
					type="date"
					bind:value={form.nextDueDate}
					class="w-full rounded-lg border px-3 py-2 dark:bg-slate-900"
				/>
			</div>
		</div>

		<div>
			<label class="mb-1 block text-sm font-medium" for="notes">Note</label>
			<textarea
				id="notes"
				bind:value={form.notes}
				rows="3"
				class="w-full rounded-lg border px-3 py-2 dark:bg-slate-900"
			></textarea>
		</div>

		<div class="flex gap-2">
			<button
				type="submit"
				disabled={submitting}
				class="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
				>{submitting ? 'Se creează...' : 'Creează cont'}</button
			>
			<a
				href="/{tenantSlug}/hosting/accounts"
				class="rounded-lg border px-4 py-2 text-sm">Anulează</a
			>
		</div>
	</form>
</div>
