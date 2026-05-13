<script lang="ts">
	import { page } from '$app/state';
	import { getDAServer, syncDAPackages, debugRawPackageResponse } from '$lib/remotes/da-servers.remote';
	import { toast } from 'svelte-sonner';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import RefreshIcon from '@lucide/svelte/icons/refresh-cw';
	import BugIcon from '@lucide/svelte/icons/bug';
	import CheckIcon from '@lucide/svelte/icons/check';
	import XIcon from '@lucide/svelte/icons/x';

	const tenantSlug = $derived(page.params.tenant);
	const serverId = $derived(page.params.serverId as string);
	let server = $state<ReturnType<typeof getDAServer> | null>(null);
	$effect(() => {
		if (serverId) server = getDAServer(serverId);
	});

	let syncing = $state(false);
	let diagOpen = $state(false);
	let diagPkg = $state('');
	let diagResult = $state<{ path: string; status: number; body: string } | null>(null);
	let diagLoading = $state(false);

	async function runSync() {
		syncing = true;
		try {
			const result = await syncDAPackages(serverId);
			const failed = result.failures?.length ?? 0;
			if (failed > 0) {
				toast.warning(
					`Sync: ${result.synced} adăugate, ${result.updated} actualizate, ${result.deactivated} dezactivate, ${failed} eșecuri. Vezi diagnostic pentru detalii.`
				);
			} else {
				toast.success(
					`Sync OK: ${result.synced} adăugate, ${result.updated} actualizate, ${result.deactivated} dezactivate.`
				);
			}
			server = getDAServer(serverId);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la sync');
		} finally {
			syncing = false;
		}
	}

	async function runDiagnostic(pkgName: string = '') {
		diagLoading = true;
		diagResult = null;
		diagPkg = pkgName;
		try {
			diagResult = await debugRawPackageResponse({
				serverId,
				packageName: pkgName || undefined
			});
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare diagnostic');
		} finally {
			diagLoading = false;
		}
	}

	function fmtLimit(v: number | null, unit?: string): string {
		if (v === null || v === undefined) return 'Nelimitat';
		return unit ? `${v.toLocaleString('ro-RO')} ${unit}` : v.toLocaleString('ro-RO');
	}
</script>

<div class="space-y-6">
	<a
		href="/{tenantSlug}/hosting/servers"
		class="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
	>
		<ArrowLeftIcon class="size-4" /> Înapoi la servere
	</a>

	{#if !server}
		<div class="text-center text-slate-500">Se încarcă...</div>
	{:else}
	{#await server}
		<div class="text-center text-slate-500">Se încarcă...</div>
	{:then s}
		<div class="flex items-start justify-between gap-4">
			<div>
				<h1 class="text-2xl font-bold">{s.name}</h1>
				<p class="text-slate-500">{s.hostname}:{s.port}</p>
			</div>
			<div class="flex gap-2">
				<button
					onclick={runSync}
					disabled={syncing}
					class="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
				>
					<RefreshIcon class="size-4 {syncing ? 'animate-spin' : ''}" />
					{syncing ? 'Se sincronizează...' : 'Sync pachete'}
				</button>
				<button
					onclick={() => {
						diagOpen = !diagOpen;
						if (diagOpen && !diagResult) runDiagnostic('');
					}}
					class="inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
				>
					<BugIcon class="size-4" /> Diagnostic
				</button>
			</div>
		</div>

		<div class="grid grid-cols-3 gap-4">
			<div class="rounded-xl border bg-white p-4 dark:bg-slate-800">
				<div class="text-xs uppercase text-slate-500">Status</div>
				<div class="mt-1 font-medium">
					{s.isActive ? (s.lastError ? 'Eroare' : 'Activ') : 'Dezactivat'}
				</div>
			</div>
			<div class="rounded-xl border bg-white p-4 dark:bg-slate-800">
				<div class="text-xs uppercase text-slate-500">Versiune DA</div>
				<div class="mt-1 font-medium">{s.daVersion ?? '—'}</div>
			</div>
			<div class="rounded-xl border bg-white p-4 dark:bg-slate-800">
				<div class="text-xs uppercase text-slate-500">Ultim check</div>
				<div class="mt-1 text-sm">
					{s.lastCheckedAt ? new Date(s.lastCheckedAt).toLocaleString('ro-RO') : '—'}
				</div>
			</div>
		</div>

		{#if s.lastError}
			<div class="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:bg-red-950/30">
				<strong>Eroare:</strong>
				{s.lastError}
			</div>
		{/if}

		{#if diagOpen}
			<div class="rounded-xl border bg-amber-50 p-4 dark:bg-amber-950/20">
				<div class="mb-3 flex items-center justify-between gap-3">
					<h3 class="text-sm font-semibold">Diagnostic — raw DA response</h3>
					<div class="flex items-center gap-2">
						<input
							placeholder="(opțional) nume pachet"
							bind:value={diagPkg}
							class="rounded border px-2 py-1 text-sm dark:bg-slate-900"
						/>
						<button
							onclick={() => runDiagnostic(diagPkg)}
							disabled={diagLoading}
							class="rounded bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
						>
							{diagLoading ? 'Se interoghează...' : 'Fetch raw'}
						</button>
					</div>
				</div>
				{#if diagResult}
					<div class="text-xs text-slate-600 dark:text-slate-400">
						<div>Path: <code>{diagResult.path}</code> · HTTP {diagResult.status}</div>
						<pre class="mt-2 overflow-auto rounded bg-slate-900 p-3 text-xs text-green-200">{diagResult.body || '(empty)'}</pre>
					</div>
				{/if}
			</div>
		{/if}

		<div class="rounded-xl border bg-white dark:bg-slate-800">
			<div class="border-b p-4 font-medium">Pachete DirectAdmin ({s.packages.length})</div>
			<div class="divide-y">
				{#if s.packages.length === 0}
					<div class="p-6 text-center text-slate-500">
						Niciun pachet sincronizat. Apasă "Sync pachete" pentru a citi din DA.
					</div>
				{:else}
					{#each s.packages as pkg (pkg.id)}
						<div class="p-4">
							<div class="flex items-start justify-between gap-3">
								<div>
									<div class="flex items-center gap-2">
										<h4 class="font-semibold">{pkg.daName}</h4>
										<span class="rounded bg-slate-100 px-1.5 py-0.5 text-xs dark:bg-slate-700"
											>{pkg.type}</span
										>
										{#if !pkg.isActive}
											<span class="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700">
												Inactiv pe DA
											</span>
										{/if}
									</div>
									<p class="text-xs text-slate-500">
										{pkg.lastSyncedAt ? `Sync: ${new Date(pkg.lastSyncedAt).toLocaleString('ro-RO')}` : 'Niciodată sincronizat'}
									</p>
								</div>
								<button
									onclick={() => {
										diagOpen = true;
										runDiagnostic(pkg.daName);
									}}
									class="text-xs text-amber-600 hover:underline"
								>
									Diagnostic pachet
								</button>
							</div>

							<!-- Limits grid: 10 numeric fields, 2x5 layout -->
							<div class="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
								<div class="rounded bg-slate-50 px-2 py-1 dark:bg-slate-900">
									<div class="text-[10px] uppercase text-slate-500">Disk</div>
									<div class="font-medium">{fmtLimit(pkg.quota, 'MB')}</div>
								</div>
								<div class="rounded bg-slate-50 px-2 py-1 dark:bg-slate-900">
									<div class="text-[10px] uppercase text-slate-500">Trafic</div>
									<div class="font-medium">{fmtLimit(pkg.bandwidth, 'MB')}</div>
								</div>
								<div class="rounded bg-slate-50 px-2 py-1 dark:bg-slate-900">
									<div class="text-[10px] uppercase text-slate-500">Inode</div>
									<div class="font-medium">{fmtLimit(pkg.maxInodes)}</div>
								</div>
								<div class="rounded bg-slate-50 px-2 py-1 dark:bg-slate-900">
									<div class="text-[10px] uppercase text-slate-500">Domenii</div>
									<div class="font-medium">{fmtLimit(pkg.maxDomains)}</div>
								</div>
								<div class="rounded bg-slate-50 px-2 py-1 dark:bg-slate-900">
									<div class="text-[10px] uppercase text-slate-500">Subdomenii</div>
									<div class="font-medium">{fmtLimit(pkg.maxSubdomains)}</div>
								</div>
								<div class="rounded bg-slate-50 px-2 py-1 dark:bg-slate-900">
									<div class="text-[10px] uppercase text-slate-500">Domain ptr</div>
									<div class="font-medium">{fmtLimit(pkg.maxDomainPointers)}</div>
								</div>
								<div class="rounded bg-slate-50 px-2 py-1 dark:bg-slate-900">
									<div class="text-[10px] uppercase text-slate-500">Email</div>
									<div class="font-medium">{fmtLimit(pkg.maxEmailAccounts)}</div>
								</div>
								<div class="rounded bg-slate-50 px-2 py-1 dark:bg-slate-900">
									<div class="text-[10px] uppercase text-slate-500">Forwarders</div>
									<div class="font-medium">{fmtLimit(pkg.maxEmailForwarders)}</div>
								</div>
								<div class="rounded bg-slate-50 px-2 py-1 dark:bg-slate-900">
									<div class="text-[10px] uppercase text-slate-500">DB MySQL</div>
									<div class="font-medium">{fmtLimit(pkg.maxDatabases)}</div>
								</div>
								<div class="rounded bg-slate-50 px-2 py-1 dark:bg-slate-900">
									<div class="text-[10px] uppercase text-slate-500">FTP</div>
									<div class="font-medium">{fmtLimit(pkg.maxFtpAccounts)}</div>
								</div>
							</div>

							<!-- Flags: chips for the ~14 boolean access controls -->
							<div class="mt-3 flex flex-wrap gap-1.5 text-xs">
								{#each [['SSL', pkg.ssl], ['SSH', pkg.ssh], ['Cron', pkg.cron], ['CGI', pkg.cgi], ['PHP', pkg.php], ['DNS', pkg.dnsControl], ['SpamAssassin', pkg.spam], ['ClamAV', pkg.clamav], ['WordPress', pkg.wordpress], ['Git', pkg.git], ['Redis', pkg.redis], ['Anon FTP', pkg.anonymousFtp], ['Suspend@limit', pkg.suspendAtLimit], ['Oversold', pkg.oversold]] as [label, enabled]}
									<span
										class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 {enabled
											? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
											: 'bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500'}"
									>
										{#if enabled}
											<CheckIcon class="size-3" />
										{:else}
											<XIcon class="size-3" />
										{/if}
										{label}
									</span>
								{/each}
							</div>

							{#if pkg.skin || pkg.language}
								<div class="mt-3 flex gap-3 text-xs text-slate-500">
									{#if pkg.skin}<span>Skin: <strong>{pkg.skin}</strong></span>{/if}
									{#if pkg.language}<span>Limbă: <strong>{pkg.language}</strong></span>{/if}
								</div>
							{/if}
						</div>
					{/each}
				{/if}
			</div>
		</div>
	{:catch err}
		<div class="text-red-600">Eroare: {err.message}</div>
	{/await}
	{/if}
</div>
