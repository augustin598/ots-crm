<script lang="ts">
	import { page } from '$app/state';
	import { getDAServers } from '$lib/remotes/da-servers.remote';
	import ServerIcon from '@lucide/svelte/icons/server';

	const tenantSlug = $derived(page.params.tenant);
	const servers = getDAServers();
</script>

<div class="space-y-6">
	<div>
		<h1 class="text-2xl font-bold">DirectAdmin Hosting — Setări</h1>
		<p class="text-slate-500">
			Pluginul DirectAdmin permite managementul serverelor DA, conturilor de hosting și suspendarea
			automată la facturi overdue. Configurarea se face per-server.
		</p>
	</div>

	<div class="rounded-xl border bg-white p-6 dark:bg-slate-800">
		<div class="flex items-center justify-between">
			<div>
				<h2 class="font-medium">Servere DirectAdmin</h2>
				<p class="text-sm text-slate-500">
					Adaugă serverele de pe care vrei să gestionezi conturi.
				</p>
			</div>
			<a
				href="/{tenantSlug}/hosting/servers"
				class="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
			>
				<ServerIcon class="size-4" /> Gestionează servere
			</a>
		</div>

		{#await servers then list}
			{#if list.length === 0}
				<div class="mt-4 rounded-lg border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-800">
					Niciun server configurat. Adaugă cel puțin un server pentru a putea crea conturi hosting.
				</div>
			{:else}
				<ul class="mt-4 divide-y">
					{#each list as srv (srv.id)}
						<li class="flex items-center justify-between py-2">
							<div>
								<div class="font-medium">{srv.name}</div>
								<div class="text-xs text-slate-500">{srv.hostname}:{srv.port}</div>
							</div>
							<span
								class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs {srv.isActive &&
								!srv.lastError
									? 'bg-green-100 text-green-700'
									: 'bg-red-100 text-red-700'}">{srv.isActive && !srv.lastError
									? 'Activ'
									: 'Eroare'}</span
							>
						</li>
					{/each}
				</ul>
			{/if}
		{/await}
	</div>

	<div class="rounded-xl border bg-white p-6 dark:bg-slate-800">
		<h2 class="font-medium">Hook-uri auto-suspend</h2>
		<p class="mt-2 text-sm text-slate-600">
			Pluginul ascultă următoarele evenimente CRM și acționează automat:
		</p>
		<ul class="mt-3 list-inside list-disc space-y-1 text-sm">
			<li>
				<strong>Factură → overdue</strong>: toate conturile hosting active ale clientului sunt
				suspendate pe DA, cu marcaj
				<code class="rounded bg-slate-100 px-1 dark:bg-slate-700">Overdue invoice &lt;număr&gt;</code>.
			</li>
			<li>
				<strong>Factură → paid</strong>: dacă NU mai există alte facturi overdue pentru acel
				client, conturile suspendate automat sunt reactivate. Conturile suspendate manual nu sunt
				atinse.
			</li>
		</ul>
	</div>

	<div class="rounded-xl border bg-white p-6 dark:bg-slate-800">
		<h2 class="font-medium">Securitate credențiale</h2>
		<p class="mt-2 text-sm text-slate-600">
			Toate credențialele DA sunt criptate per-tenant cu AES-256-GCM înainte de a fi salvate. Cheia
			este derivată din variabila de mediu <code class="rounded bg-slate-100 px-1 dark:bg-slate-700"
				>ENCRYPTION_SECRET</code
			>.
		</p>
	</div>
</div>
