<script lang="ts">
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import {
		getDAServers,
		addDAServer,
		testDAServer,
		syncDAPackages,
		deleteDAServer
	} from '$lib/remotes/da-servers.remote';
	import ServerIcon from '@lucide/svelte/icons/server';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';

	const tenantSlug = $derived(page.params.tenant);

	let servers = $state(getDAServers());

	let showForm = $state(false);
	let form = $state({
		name: '',
		hostname: '',
		port: 2222,
		useHttps: true,
		username: '',
		password: ''
	});
	let submitting = $state(false);

	// Live preview of what will actually be saved (mirrors server-side parseHostname).
	const parsed = $derived.by(() => {
		let s = (form.hostname ?? '').trim();
		let detectedProto: 'http' | 'https' | null = null;
		if (s.startsWith('https://')) {
			detectedProto = 'https';
			s = s.slice(8);
		} else if (s.startsWith('http://')) {
			detectedProto = 'http';
			s = s.slice(7);
		}
		s = s.replace(/\/+$/, '').split('/')[0];
		const m = s.match(/^([^:]+)(?::(\d+))?$/);
		const host = m ? m[1] : s;
		const detectedPort = m && m[2] ? parseInt(m[2], 10) : null;
		return {
			host,
			port: detectedPort ?? form.port ?? 2222,
			useHttps: detectedProto === 'http' ? false : detectedProto === 'https' ? true : form.useHttps,
			detectedProto,
			detectedPort
		};
	});

	async function refresh() {
		servers = getDAServers();
	}

	async function submit() {
		submitting = true;
		try {
			const result = await addDAServer(form);
			toast.success(
				result.online
					? `Server adăugat (răspuns ${result.responseMs}ms)`
					: 'Server adăugat, dar testul a eșuat'
			);
			showForm = false;
			form = { name: '', hostname: '', port: 2222, useHttps: true, username: '', password: '' };
			await refresh();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare adăugare server');
		} finally {
			submitting = false;
		}
	}

	async function handleTest(id: string) {
		try {
			const r = await testDAServer(id);
			toast[r.online ? 'success' : 'error'](
				r.online ? `Online (${r.responseMs}ms)` : r.error ?? 'Offline'
			);
			await refresh();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare test');
		}
	}

	async function handleSync(id: string) {
		try {
			const r = await syncDAPackages(id);
			toast.success(`${r.synced} pachete noi din ${r.total}`);
			await refresh();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare sync');
		}
	}

	async function handleDelete(id: string) {
		if (!confirm('Dezactivezi acest server? Va dispărea din listă (soft-delete, datele rămân în DB pentru audit).')) return;
		try {
			await deleteDAServer(id);
			toast.success('Server dezactivat');
			await refresh();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare ștergere');
		}
	}
</script>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<div>
			<h1 class="text-2xl font-bold">Servere DirectAdmin</h1>
			<p class="text-slate-500">Conectează serverele DA pentru a putea crea conturi hosting</p>
		</div>
		<button
			onclick={() => (showForm = !showForm)}
			class="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
		>
			<PlusIcon class="size-4" /> Adaugă server
		</button>
	</div>

	{#if showForm}
		<form
			onsubmit={(e) => {
				e.preventDefault();
				submit();
			}}
			class="space-y-4 rounded-xl border bg-white p-6 dark:bg-slate-800"
		>
			<div>
				<h2 class="font-medium">Server nou</h2>
				<p class="text-xs text-slate-500">
					Conectează un server DirectAdmin folosind un cont admin sau reseller cu API access activ.
				</p>
			</div>

			<div class="grid grid-cols-2 gap-4">
				<div>
					<label class="mb-1 block text-sm font-medium" for="name">Nume intern *</label>
					<input
						id="name"
						bind:value={form.name}
						required
						placeholder="ex: Server Principal București"
						class="w-full rounded-lg border px-3 py-2 dark:bg-slate-900"
					/>
					<p class="mt-1 text-xs text-slate-500">
						Un nume prietenos doar pentru tine (apare în listă și meniuri). NU URL-ul serverului.
					</p>
				</div>
				<div>
					<label class="mb-1 block text-sm font-medium" for="hostname">Hostname / IP *</label>
					<input
						id="hostname"
						bind:value={form.hostname}
						required
						placeholder="ex: 46.4.159.108  sau  da.onetopsolution.ro"
						class="w-full rounded-lg border px-3 py-2 dark:bg-slate-900"
					/>
					<p class="mt-1 text-xs text-slate-500">
						Adresa la care răspunde DirectAdmin — IP public sau subdomeniu. <strong>Fără</strong>
						<code class="rounded bg-slate-100 px-1 dark:bg-slate-700">https://</code> și fără port.
					</p>
				</div>
				<div>
					<label class="mb-1 block text-sm font-medium" for="port">Port</label>
					<input
						id="port"
						type="number"
						bind:value={form.port}
						placeholder="2222"
						class="w-full rounded-lg border px-3 py-2 dark:bg-slate-900"
					/>
					<p class="mt-1 text-xs text-slate-500">
						Implicit DirectAdmin: <code class="rounded bg-slate-100 px-1 dark:bg-slate-700">2222</code>.
					</p>
				</div>
				<div>
					<span class="mb-1 block text-sm font-medium">Protocol</span>
					<div class="flex gap-4 rounded-lg border px-3 py-2 dark:bg-slate-900">
						<label class="flex items-center gap-2 text-sm">
							<input type="radio" bind:group={form.useHttps} value={true} /> HTTPS
						</label>
						<label class="flex items-center gap-2 text-sm">
							<input type="radio" bind:group={form.useHttps} value={false} /> HTTP
						</label>
					</div>
					<p class="mt-1 text-xs text-slate-500">
						Implicit <strong>HTTPS</strong>. Alege HTTP doar dacă serverul tău nu are TLS pe portul
						DA (servere legacy).
					</p>
				</div>
				<div>
					<label class="mb-1 block text-sm font-medium" for="username">Utilizator admin *</label>
					<input
						id="username"
						bind:value={form.username}
						required
						autocomplete="off"
						placeholder="ex: admin"
						class="w-full rounded-lg border px-3 py-2 dark:bg-slate-900"
					/>
					<p class="mt-1 text-xs text-slate-500">
						Username-ul contului de <strong>admin</strong> sau <strong>reseller</strong> DA. Acest
						user va crea conturile noi. Recomandat: un user dedicat cu API enabled.
					</p>
				</div>
				<div>
					<label class="mb-1 block text-sm font-medium" for="password">Parolă *</label>
					<input
						id="password"
						type="password"
						bind:value={form.password}
						required
						autocomplete="new-password"
						class="w-full rounded-lg border px-3 py-2 dark:bg-slate-900"
					/>
					<p class="mt-1 text-xs text-slate-500">
						Parola contului de mai sus, SAU un <strong>login key</strong> generat din DA cu
						permisiuni API. Va fi criptată AES-256-GCM înainte de salvare.
					</p>
				</div>
			</div>

			<div class="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-200">
				<strong>URL efectiv folosit</strong>:
				<code class="rounded bg-blue-100 px-1 dark:bg-blue-900"
					>{parsed.useHttps ? 'https' : 'http'}://{parsed.host || '<hostname>'}:{parsed.port}</code
				>
				{#if parsed.detectedProto || parsed.detectedPort}
					<br />
					<span class="text-amber-700 dark:text-amber-300">
						⚠ Am detectat
						{#if parsed.detectedProto}protocolul <strong>{parsed.detectedProto}</strong>{/if}
						{#if parsed.detectedProto && parsed.detectedPort} și {/if}
						{#if parsed.detectedPort}portul <strong>{parsed.detectedPort}</strong>{/if}
						în câmpul Hostname. Le voi extrage automat — câmpul Hostname va fi salvat curat ca
						<code class="rounded bg-amber-100 px-1 dark:bg-amber-900">{parsed.host}</code>.
					</span>
				{/if}
			</div>

			<div class="flex gap-2">
				<button
					type="submit"
					disabled={submitting}
					class="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
					>{submitting ? 'Se adaugă & testează...' : 'Adaugă & testează conexiunea'}</button
				>
				<button
					type="button"
					onclick={() => (showForm = false)}
					class="rounded-lg border px-4 py-2 text-sm">Anulează</button
				>
			</div>
		</form>
	{/if}

	<div class="overflow-hidden rounded-xl border bg-white dark:bg-slate-800">
		{#await servers}
			<div class="p-8 text-center text-slate-500">Se încarcă...</div>
		{:then list}
			{#if list.length === 0}
				<div class="p-12 text-center">
					<ServerIcon class="mx-auto mb-3 size-10 text-slate-300" />
					<p class="text-slate-500">Niciun server configurat</p>
				</div>
			{:else}
				<table class="w-full">
					<thead>
						<tr class="border-b bg-slate-50 dark:bg-slate-900">
							<th class="px-6 py-3 text-left text-xs font-medium uppercase text-slate-500">Nume</th>
							<th class="px-6 py-3 text-left text-xs font-medium uppercase text-slate-500">Hostname</th>
							<th class="px-6 py-3 text-left text-xs font-medium uppercase text-slate-500">Status</th>
							<th class="px-6 py-3 text-left text-xs font-medium uppercase text-slate-500"
								>Ultim check</th
							>
							<th class="px-6 py-3 text-right text-xs font-medium uppercase text-slate-500"
								>Acțiuni</th
							>
						</tr>
					</thead>
					<tbody class="divide-y">
						{#each list as srv (srv.id)}
							<tr>
								<td class="px-6 py-4">
									<a
										href="/{tenantSlug}/hosting/servers/{srv.id}"
										class="font-medium text-blue-600 hover:underline">{srv.name}</a
									>
								</td>
								<td class="px-6 py-4 text-sm text-slate-700 dark:text-slate-300"
									>{srv.hostname}:{srv.port}</td
								>
								<td class="px-6 py-4">
									{#if srv.lastError}
										<span class="text-xs text-red-600">{srv.lastError}</span>
									{:else if srv.isActive}
										<span
											class="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs text-green-700"
											>Activ</span
										>
									{:else}
										<span class="text-xs text-slate-500">Dezactivat</span>
									{/if}
								</td>
								<td class="px-6 py-4 text-xs text-slate-500"
									>{srv.lastCheckedAt
										? new Date(srv.lastCheckedAt).toLocaleString('ro-RO')
										: '—'}</td
								>
								<td class="px-6 py-4 text-right">
									<div class="flex justify-end gap-2">
										<button
											onclick={() => handleTest(srv.id)}
											class="rounded p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700"
											title="Test"
										>
											<RefreshCwIcon class="size-4" />
										</button>
										<button
											onclick={() => handleSync(srv.id)}
											class="rounded p-1.5 text-blue-600 hover:bg-blue-50"
											title="Sync pachete">Sync</button
										>
										<button
											onclick={() => handleDelete(srv.id)}
											class="rounded p-1.5 text-red-600 hover:bg-red-50"
											title="Dezactivează"
										>
											<Trash2Icon class="size-4" />
										</button>
									</div>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		{/await}
	</div>
</div>
