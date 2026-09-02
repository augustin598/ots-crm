<script lang="ts">
	// Setările integrării Google Search Console. Tiparul e cel de la Google Calendar
	// (card de stare + conectare OAuth), plus tabelul de mapare proiect → proprietate,
	// care e specific aici: un tenant are proiecte pentru clienți diferiți, fiecare cu
	// proprietatea lui în Search Console.
	import { page } from '$app/state';
	import SearchIcon from '@lucide/svelte/icons/search';
	import CheckCircle2Icon from '@lucide/svelte/icons/check-circle-2';
	import XCircleIcon from '@lucide/svelte/icons/x-circle';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import {
		getGscStatus,
		getGscProperties,
		getGscProjects,
		setGscProperty,
		runGscPullNow,
		disconnectGsc
	} from '$lib/remotes/gsc.remote';

	const tenantSlug = $derived(page.params.tenant ?? '');
	const justConnected = $derived(page.url.searchParams.get('gsc') === 'connected');
	const oauthError = $derived(page.url.searchParams.get('gsc_error'));

	const statusQuery = getGscStatus();
	const status = $derived(statusQuery.current);
	const projectsQuery = getGscProjects();
	const projects = $derived(projectsQuery.current ?? []);

	// Proprietățile se cer de la Google DOAR când suntem conectați — altfel apelul
	// ar arunca „Search Console nu este conectat" la fiecare încărcare a paginii.
	const propertiesQuery = $derived(status?.connected ? getGscProperties() : null);
	const properties = $derived(propertiesQuery?.current ?? []);

	let busy = $state(false);
	let notice = $state<string | null>(null);
	let noticeKind = $state<'ok' | 'err'>('ok');

	function say(message: string, kind: 'ok' | 'err' = 'ok') {
		notice = message;
		noticeKind = kind;
	}

	/**
	 * „sc-domain:heylux.ro" și „https://www.heylux.ro/" sunt proprietăți DIFERITE, cu
	 * date diferite. Arătăm string-ul real, dar spunem în clar despre ce tip e vorba.
	 */
	function propertyLabel(p: string): string {
		return p.startsWith('sc-domain:')
			? `${p.slice('sc-domain:'.length)} — domeniu întreg`
			: `${p} — doar acest prefix`;
	}

	async function linkProperty(projectId: string, value: string) {
		busy = true;
		try {
			await setGscProperty({ projectId, property: value || null });
			await projectsQuery.refresh();
			say(value ? 'Proprietatea a fost legată.' : 'Proprietatea a fost dezlegată.');
		} catch (err) {
			say(err instanceof Error ? err.message : 'Nu am putut salva proprietatea.', 'err');
		} finally {
			busy = false;
		}
	}

	async function syncNow() {
		busy = true;
		say('Se trag datele din Search Console…');
		try {
			const r = await runGscPullNow();
			await statusQuery.refresh();
			say(
				`Gata: ${r.properties} proprietăți, ${r.rowsSaved} rânduri scrise, ${r.failed} eșecuri.`,
				r.failed > 0 ? 'err' : 'ok'
			);
		} catch (err) {
			say(err instanceof Error ? err.message : 'Tragerea a eșuat.', 'err');
		} finally {
			busy = false;
		}
	}

	async function disconnect() {
		if (!confirm('Dezactivezi integrarea Search Console? Tragerea zilnică se oprește.')) return;
		busy = true;
		try {
			await disconnectGsc();
			await statusQuery.refresh();
			say('Integrarea a fost dezactivată.');
		} catch (err) {
			say(err instanceof Error ? err.message : 'Nu am putut dezactiva integrarea.', 'err');
		} finally {
			busy = false;
		}
	}

	const linkedCount = $derived(projects.filter((p) => p.gscProperty).length);
</script>

<svelte:head>
	<title>Google Search Console · Setări</title>
</svelte:head>

<div class="mx-auto max-w-3xl space-y-6 p-6">
	<header class="space-y-1">
		<h1 class="text-2xl font-bold text-slate-900 dark:text-slate-100">Google Search Console</h1>
		<p class="text-sm text-slate-600 dark:text-slate-400">
			Aduce în Rank Tracker cifrele raportate de Google — afișări, clicuri, CTR și poziție medie —
			ca sursă care nu poate fi blocată. Când noi raportăm „negăsit" iar Google raportează afișări,
			cuvântul primește badge-ul <strong>„nemăsurat"</strong>: problema e la scrapingul nostru, nu la
			pozițiile clientului.
			<br />
			<strong>Recomandare:</strong> folosește același cont Google ca Gmail-ul, pentru consistență.
		</p>
	</header>

	{#if justConnected}
		<div
			class="rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
		>
			✓ Conectat cu succes. Leagă mai jos câte o proprietate de fiecare proiect.
		</div>
	{:else if oauthError}
		<div
			class="rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
		>
			Eroare la conectare: <code>{oauthError}</code>. Încearcă din nou.
		</div>
	{/if}

	{#if notice}
		<div
			class="rounded-lg border px-4 py-3 text-sm {noticeKind === 'ok'
				? 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'
				: 'border-red-100 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200'}"
		>
			{notice}
		</div>
	{/if}

	<!-- starea conexiunii -->
	<div
		class="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900"
	>
		<div class="flex items-start gap-4">
			<div
				class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-300"
			>
				<SearchIcon class="h-6 w-6" />
			</div>
			<div class="flex-1 space-y-3">
				{#if status?.connected && status.isActive}
					<div class="flex items-center gap-2">
						<CheckCircle2Icon class="h-5 w-5 text-emerald-600" />
						<h2 class="text-lg font-bold text-slate-900 dark:text-slate-100">Conectat</h2>
					</div>
					<p class="text-sm text-slate-600 dark:text-slate-400">
						Cont activ: <strong class="text-slate-900 dark:text-slate-100">{status.email}</strong>
						<br />
						Ultima sincronizare:
						{status.lastSyncAt
							? new Date(status.lastSyncAt).toLocaleString('ro-RO')
							: 'niciodată — jobul rulează zilnic la 05:00'}
					</p>
					{#if status.lastError}
						<p
							class="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
						>
							<TriangleAlertIcon class="mt-0.5 h-4 w-4 shrink-0" />
							<span>Ultima eroare: {status.lastError}</span>
						</p>
					{/if}
					<div class="flex flex-wrap gap-2 pt-2">
						<button
							type="button"
							disabled={busy}
							onclick={syncNow}
							class="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
						>
							<RefreshCwIcon class="h-4 w-4" />
							Sincronizează acum
						</button>
						<a
							href="/{tenantSlug}/api/_debug-gsc-health?probe=1"
							target="_blank"
							rel="noreferrer"
							class="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
						>
							Testează conexiunea
						</a>
						<button
							type="button"
							disabled={busy}
							onclick={disconnect}
							class="rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-700 hover:border-red-300 hover:bg-red-50 disabled:opacity-50 dark:bg-slate-900 dark:hover:bg-red-950"
						>
							Dezactivează
						</button>
					</div>
				{:else}
					<div class="flex items-center gap-2">
						<XCircleIcon class="h-5 w-5 text-slate-400" />
						<h2 class="text-lg font-bold text-slate-900 dark:text-slate-100">
							{status?.connected ? 'Dezactivat' : 'Neconectat'}
						</h2>
					</div>
					<p class="text-sm text-slate-600 dark:text-slate-400">
						{status?.connected
							? 'Integrarea există, dar e dezactivată. Reautorizează pentru a o reactiva.'
							: 'Conectează un cont Google care are acces la proprietățile clienților în Search Console.'}
					</p>
					<a
						href="/api/gsc/auth?tenant={tenantSlug}"
						class="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
					>
						<SearchIcon class="h-4 w-4" />
						{status?.connected ? 'Reautorizează' : 'Conectează Search Console'}
					</a>
				{/if}
			</div>
		</div>
	</div>

	<!-- maparea proiect → proprietate -->
	{#if status?.connected && status.isActive}
		<div
			class="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900"
		>
			<div class="mb-4">
				<h2 class="text-lg font-bold text-slate-900 dark:text-slate-100">Proiecte și proprietăți</h2>
				<p class="text-sm text-slate-600 dark:text-slate-400">
					{linkedCount} din {projects.length} proiecte au o proprietate legată. Proprietatea se alege
					din lista contului — „domeniu întreg" și „doar acest prefix" sunt proprietăți diferite, cu
					date diferite.
				</p>
			</div>

			{#if projects.length === 0}
				<p class="text-sm text-slate-500 dark:text-slate-400">
					Niciun proiect activ în Rank Tracker. Creează unul întâi.
				</p>
			{:else}
				<div class="space-y-3">
					{#each projects as p (p.id)}
						<div
							class="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 px-4 py-3 dark:border-slate-700"
						>
							<div class="min-w-0 flex-1">
								<div class="text-sm font-semibold text-slate-900 dark:text-slate-100">{p.name}</div>
								<div class="text-xs text-slate-500 dark:text-slate-400">{p.domain}</div>
							</div>
							<select
								disabled={busy}
								value={p.gscProperty ?? ''}
								onchange={(e) => linkProperty(p.id, e.currentTarget.value)}
								aria-label="Proprietatea Search Console pentru {p.name}"
								class="min-w-[16rem] rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
							>
								<option value="">— nelegat —</option>
								{#each properties as prop (prop)}
									<option value={prop}>{propertyLabel(prop)}</option>
								{/each}
								{#if p.gscProperty && !properties.includes(p.gscProperty)}
									<!-- proprietate legată la care contul curent nu mai are acces -->
									<option value={p.gscProperty}>{p.gscProperty} — fără acces</option>
								{/if}
							</select>
						</div>
					{/each}
				</div>

				{#if properties.length === 0}
					<p
						class="mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
					>
						<TriangleAlertIcon class="mt-0.5 h-4 w-4 shrink-0" />
						<span>
							Contul conectat nu are nicio proprietate verificată în Search Console — sau apelul a
							eșuat. Verifică cu „Testează conexiunea": dacă răspunsul conține
							<code>SERVICE_DISABLED</code>, Search Console API nu e activat în proiectul Google Cloud.
						</span>
					</p>
				{/if}
			{/if}
		</div>
	{/if}

	<div
		class="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
	>
		<strong>Cum funcționează:</strong> zilnic la 05:00 (înaintea verificării de poziții) tragem
		ultimele 7 zile pentru fiecare proiect care are proprietate legată și scriem o linie per
		(cuvânt urmărit, dispozitiv, zi). Fereastra se retrage la fiecare rulare fiindcă Google
		rescrie retroactiv ultimele 2-3 zile. Datele au ~2 zile întârziere, iar poziția medie din
		Search Console e mediată peste dispozitive, locații și pagini — de aceea NU o contopim
		niciodată cu poziția scrapată, ci le ținem în coloane separate.
	</div>
</div>
