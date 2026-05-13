<script lang="ts">
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import {
		testWHMCSConnection,
		importFromWHMCS,
		getWHMCSHostingImportLogs,
		getWHMCSImportConfig,
		saveWHMCSImportConfig
	} from '$lib/remotes/whmcs-import-da.remote';
	import { getDAServers } from '$lib/remotes/da-servers.remote';
	import { onMount } from 'svelte';

	const tenantSlug = $derived(page.params.tenant);
	const servers = getDAServers();
	let logs = $state(getWHMCSHostingImportLogs());

	let step = $state(1);
	let conn = $state({ host: '', port: 3306, user: '', password: '', database: '' });
	let entities = $state({ product: true, service: true, domain: true });
	let serverMappings = $state<Record<string, string>>({});
	let currencyId = $state(1);
	let autoCreateMissingClients = $state(false);
	let testing = $state(false);
	let importing = $state(false);
	let savingConfig = $state(false);
	let configLoaded = $state(false);

	onMount(async () => {
		try {
			const saved = await getWHMCSImportConfig();
			if (saved) {
				conn = {
					host: saved.host,
					port: saved.port,
					user: saved.user,
					password: saved.password,
					database: saved.database
				};
			}
		} catch (e) {
			// non-blocking: form still works empty
			console.warn('[whmcs-import] no saved config', e);
		} finally {
			configLoaded = true;
		}
	});

	async function saveConfig() {
		savingConfig = true;
		try {
			await saveWHMCSImportConfig({ ...conn });
			toast.success('Credențiale salvate');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Salvare eșuată');
		} finally {
			savingConfig = false;
		}
	}

	type ImportStats = {
		imported: number;
		skipped: number;
		errors: number;
		errorDetails: string[];
		byType: {
			product?: { imported: number; skipped: number; errors: number };
			service?: { imported: number; skipped: number; errors: number };
			domain?: { imported: number; skipped: number; errors: number };
			client?: {
				matchedByWhmcsId: number;
				matchedByCui: number;
				matchedByEmail: number;
				created: number;
			};
		};
	};
	let lastResult = $state<ImportStats | null>(null);

	async function test() {
		testing = true;
		try {
			await testWHMCSConnection(conn);
			toast.success('Conexiune OK — credențiale salvate');
			// auto-persist on successful test so next visit is one-click
			try {
				await saveWHMCSImportConfig({ ...conn });
			} catch (e) {
				console.warn('[whmcs-import] save after test failed', e);
			}
			step = 2;
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Conexiune eșuată');
		} finally {
			testing = false;
		}
	}

	async function runImport() {
		const selectedEntities = (Object.keys(entities) as Array<'product' | 'service' | 'domain'>)
			.filter((e) => entities[e]);
		if (selectedEntities.length === 0) {
			toast.error('Selectează cel puțin o entitate');
			return;
		}
		importing = true;
		try {
			const result = await importFromWHMCS({
				...conn,
				entities: selectedEntities,
				serverMappings,
				currencyId,
				autoCreateMissingClients
			});
			lastResult = result as ImportStats;
			toast.success(`Import complet: ${result.imported} importate, ${result.skipped} skip, ${result.errors} erori`);
			logs = getWHMCSHostingImportLogs();
			step = 3;
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare import');
		} finally {
			importing = false;
		}
	}
</script>

<div class="max-w-3xl space-y-6">
	<div>
		<h1 class="text-2xl font-bold">Import WHMCS → Hosting</h1>
		<p class="text-slate-500">
			Importă produse, servicii și domenii dintr-o instalare WHMCS. Clienții, facturile și
			ticketele se importă prin integrarea WHMCS din Settings.
		</p>
	</div>

	<div class="flex gap-2">
		<div class="rounded-full px-3 py-1 text-sm {step >= 1 ? 'bg-blue-600 text-white' : 'bg-slate-200'}">
			1. Conexiune
		</div>
		<div class="rounded-full px-3 py-1 text-sm {step >= 2 ? 'bg-blue-600 text-white' : 'bg-slate-200'}">
			2. Opțiuni
		</div>
		<div class="rounded-full px-3 py-1 text-sm {step >= 3 ? 'bg-blue-600 text-white' : 'bg-slate-200'}">
			3. Rezultat
		</div>
	</div>

	{#if step === 1}
		<form
			onsubmit={(e) => {
				e.preventDefault();
				test();
			}}
			class="space-y-4 rounded-xl border bg-white p-6 dark:bg-slate-800"
		>
			<div class="grid grid-cols-2 gap-4">
				<div>
					<label class="mb-1 block text-sm" for="h">Host MySQL</label>
					<input
						id="h"
						bind:value={conn.host}
						required
						placeholder="db.whmcs.example.com"
						class="w-full rounded-lg border px-3 py-2 dark:bg-slate-900"
					/>
				</div>
				<div>
					<label class="mb-1 block text-sm" for="p">Port</label>
					<input
						id="p"
						type="number"
						bind:value={conn.port}
						class="w-full rounded-lg border px-3 py-2 dark:bg-slate-900"
					/>
				</div>
				<div>
					<label class="mb-1 block text-sm" for="u">User</label>
					<input
						id="u"
						bind:value={conn.user}
						required
						class="w-full rounded-lg border px-3 py-2 dark:bg-slate-900"
					/>
				</div>
				<div>
					<label class="mb-1 block text-sm" for="pw">Parolă</label>
					<input
						id="pw"
						type="password"
						bind:value={conn.password}
						required
						class="w-full rounded-lg border px-3 py-2 dark:bg-slate-900"
					/>
				</div>
				<div class="col-span-2">
					<label class="mb-1 block text-sm" for="db">Database</label>
					<input
						id="db"
						bind:value={conn.database}
						required
						placeholder="whmcs"
						class="w-full rounded-lg border px-3 py-2 dark:bg-slate-900"
					/>
				</div>
			</div>
			<div class="flex items-center gap-2">
				<button
					type="submit"
					disabled={testing}
					class="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
					>{testing ? 'Se testează...' : 'Testează conexiunea'}</button
				>
				<button
					type="button"
					onclick={saveConfig}
					disabled={savingConfig}
					class="rounded-lg border px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-50 dark:hover:bg-slate-700"
					>{savingConfig ? 'Salvez...' : 'Salvează credențialele'}</button
				>
				{#if !configLoaded}
					<span class="text-xs text-slate-500">se încarcă...</span>
				{/if}
			</div>
		</form>
	{:else if step === 2}
		<div class="space-y-4 rounded-xl border bg-white p-6 dark:bg-slate-800">
			<div>
				<h2 class="font-medium">Entități de importat</h2>
				<div class="mt-2 space-y-2">
					<label class="flex items-center gap-2"
						><input type="checkbox" bind:checked={entities.product} /> Produse hosting</label
					>
					<label class="flex items-center gap-2"
						><input type="checkbox" bind:checked={entities.service} /> Servicii hosting</label
					>
					<label class="flex items-center gap-2"
						><input type="checkbox" bind:checked={entities.domain} /> Domenii</label
					>
				</div>
			</div>

			<div>
				<h2 class="font-medium">Clienți lipsă</h2>
				<label class="mt-2 flex items-start gap-2">
					<input type="checkbox" bind:checked={autoCreateMissingClients} class="mt-1" />
					<span class="text-sm">
						<strong>Creează clienți noi în CRM dacă nu există match</strong> (default: OFF)<br />
						<span class="text-xs text-slate-500">
							Cascadă de match: <code class="rounded bg-slate-100 px-1 dark:bg-slate-700">whmcsClientId</code>
							→ <code class="rounded bg-slate-100 px-1 dark:bg-slate-700">CUI</code> normalizat (strip
							<code class="rounded bg-slate-100 px-1 dark:bg-slate-700">RO</code>, lowercase)
							→ <code class="rounded bg-slate-100 px-1 dark:bg-slate-700">email</code> lowercased
							→ <strong>creare</strong> (doar dacă bifezi). Workflow normal: clienții există deja în
							CRM (sincronizați prin Keez / ANAF / manual), iar importul doar îi linkează prin CUI.
							Bifează doar dacă WHMCS-ul are clienți care lipsesc complet din CRM.
						</span>
					</span>
				</label>
			</div>

			<div>
				<h2 class="font-medium">Monedă pentru prețuri produse</h2>
				<p class="text-xs text-slate-500">
					ID-ul din <code class="rounded bg-slate-100 px-1 dark:bg-slate-700">tblcurrencies</code> al
					monedei în care vrei să citești prețurile produselor. Default <strong>1</strong> = moneda
					default a instalării WHMCS. Verifică în WHMCS Admin → Setup → Payments → Currencies dacă
					ai mai multe.
				</p>
				<input
					type="number"
					min="1"
					bind:value={currencyId}
					class="mt-2 w-32 rounded-lg border px-3 py-2 dark:bg-slate-900"
				/>
			</div>

			<div>
				<h2 class="font-medium">Mapping WHMCS server ID → server DA</h2>
				<p class="text-xs text-slate-500">
					Pune ID-ul WHMCS al fiecărui server în coloana din stânga și alege serverul DA echivalent
					din dreapta.
				</p>
				{#await servers then list}
					<div class="mt-2 space-y-2">
						{#each [1, 2, 3, 4, 5] as whmcsServerId}
							<div class="flex items-center gap-2">
								<span class="w-20 text-sm">WHMCS #{whmcsServerId}</span>
								<select
									bind:value={serverMappings[whmcsServerId]}
									class="flex-1 rounded-lg border px-3 py-2 dark:bg-slate-900"
								>
									<option value="">— nu importa de pe acest server —</option>
									{#each list as s (s.id)}
										<option value={s.id}>{s.name}</option>
									{/each}
								</select>
							</div>
						{/each}
					</div>
				{/await}
			</div>

			<div class="flex gap-2">
				<button
					onclick={runImport}
					disabled={importing}
					class="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
					>{importing ? 'Se importă...' : 'Începe importul'}</button
				>
				<button onclick={() => (step = 1)} class="rounded-lg border px-4 py-2 text-sm"
					>Înapoi</button
				>
			</div>
		</div>
	{:else if step === 3 && lastResult}
		<div class="space-y-4 rounded-xl border bg-white p-6 dark:bg-slate-800">
			<h2 class="text-lg font-medium">Rezultat import</h2>
			<div class="grid grid-cols-3 gap-4">
				<div class="rounded-lg bg-green-50 p-4">
					<div class="text-xs text-green-700">Importate</div>
					<div class="text-2xl font-bold text-green-900">{lastResult.imported}</div>
				</div>
				<div class="rounded-lg bg-yellow-50 p-4">
					<div class="text-xs text-yellow-700">Skip</div>
					<div class="text-2xl font-bold text-yellow-900">{lastResult.skipped}</div>
				</div>
				<div class="rounded-lg bg-red-50 p-4">
					<div class="text-xs text-red-700">Erori</div>
					<div class="text-2xl font-bold text-red-900">{lastResult.errors}</div>
				</div>
			</div>

			{#if lastResult.byType.client}
				{@const c = lastResult.byType.client}
				{#if c.matchedByWhmcsId + c.matchedByCui + c.matchedByEmail + c.created > 0}
					<div class="space-y-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-200">
						<div><strong>Clienți</strong> (cascadă match-or-create):</div>
						<div class="grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
							<div>
								<span class="font-semibold">{c.matchedByWhmcsId}</span> deja linkați (whmcs_client_id)
							</div>
							<div>
								<span class="font-semibold">{c.matchedByCui}</span> match după CUI — linkați automat
							</div>
							<div>
								<span class="font-semibold">{c.matchedByEmail}</span> match după email — linkați automat
							</div>
							<div>
								<span class="font-semibold">{c.created}</span> creați nou din WHMCS
							</div>
						</div>
					</div>
				{/if}
			{/if}
			{#if lastResult.errorDetails.length > 0}
				<details class="rounded-lg border p-3">
					<summary class="cursor-pointer text-sm font-medium">Detalii erori</summary>
					<ul class="mt-2 space-y-1 text-xs">
						{#each lastResult.errorDetails as msg}
							<li class="text-red-600">{msg}</li>
						{/each}
					</ul>
				</details>
			{/if}
			<button onclick={() => (step = 1)} class="rounded-lg border px-4 py-2 text-sm">Import nou</button>
		</div>
	{/if}

	<div class="rounded-xl border bg-white dark:bg-slate-800">
		<div class="border-b p-4 font-medium">Istoric import</div>
		{#await logs}
			<div class="p-4 text-sm text-slate-500">Se încarcă...</div>
		{:then list}
			{#if list.length === 0}
				<div class="p-4 text-sm text-slate-500">Nicio operațiune.</div>
			{:else}
				<div class="max-h-96 divide-y overflow-y-auto text-sm">
					{#each list as l (l.id)}
						<div class="flex justify-between px-4 py-2">
							<span>{l.entityType} #{l.sourceId}</span>
							<span class="text-xs">
								<span
									class={l.status === 'success'
										? 'text-green-600'
										: l.status === 'skipped'
										? 'text-yellow-600'
										: 'text-red-600'}>{l.status}</span
								>
								{#if l.errorMessage}<span class="text-slate-500"> · {l.errorMessage}</span>{/if}
							</span>
						</div>
					{/each}
				</div>
			{/if}
		{/await}
	</div>
</div>
