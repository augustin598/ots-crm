<script lang="ts">
	import {
		startScraperSession,
		checkScraperLogin,
		runScraper,
		cancelScraperSession
	} from '$lib/remotes/invoice-scraper.remote';
	import { Card } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { toast } from 'svelte-sonner';
	import MonitorIcon from '@lucide/svelte/icons/monitor';
	import LoaderIcon from '@lucide/svelte/icons/loader';
	import CheckCircleIcon from '@lucide/svelte/icons/check-circle';
	import XCircleIcon from '@lucide/svelte/icons/x-circle';
	import CookieIcon from '@lucide/svelte/icons/cookie';
	import { SvelteSet } from 'svelte/reactivity';

	interface Props {
		platform: 'meta' | 'google' | 'tiktok';
		integrationId: string;
		onImport?: (invoices: any[]) => Promise<void>;
		showTrigger?: boolean;
	}

	let { platform, integrationId, onImport, showTrigger = true }: Props = $props();

	export function start() {
		handleStartScraper();
	}

	type PanelStatus = 'idle' | 'launching' | 'waiting_login' | 'checking_login' | 'scraping' | 'done' | 'error';

	let status = $state<PanelStatus>('idle');
	let sessionId = $state<string | null>(null);
	let invoices = $state<any[]>([]);
	let cookiesRefreshed = $state(false);
	let errorMessage = $state('');
	let selectedIds = new SvelteSet<string>();
	let importing = $state(false);

	const platformNames = {
		meta: 'Facebook',
		google: 'Google Ads',
		tiktok: 'TikTok'
	};

	const platformName = $derived(platformNames[platform]);

	async function handleStartScraper() {
		status = 'launching';
		errorMessage = '';
		invoices = [];
		selectedIds.clear();

		try {
			const result = await startScraperSession({ platform, integrationId });
			sessionId = result.sessionId;
			status = 'waiting_login';
			toast.info(`Browserul s-a deschis. Loghează-te în ${platformName}.`);
		} catch (e) {
			status = 'error';
			errorMessage = e instanceof Error ? e.message : 'Eroare la pornirea browserului';
			toast.error(errorMessage);
		}
	}

	async function handleCheckLogin() {
		if (!sessionId) return;
		status = 'checking_login';

		try {
			const result = await checkScraperLogin({ sessionId });
			if (result.loggedIn) {
				status = 'scraping';
				toast.success('Login detectat! Se extrag facturile...');
				await handleRunScraper();
			} else {
				status = 'waiting_login';
				toast.info('Nu ești logat încă. Finalizează login-ul în browser și încearcă din nou.');
			}
		} catch (e) {
			status = 'error';
			errorMessage = e instanceof Error ? e.message : 'Eroare la verificare';
			toast.error(errorMessage);
		}
	}

	async function handleRunScraper() {
		if (!sessionId) return;
		status = 'scraping';

		try {
			const result = await runScraper({ sessionId });
			invoices = result.invoices || [];
			cookiesRefreshed = result.cookiesRefreshed;
			status = 'done';

			if (invoices.length > 0) {
				// Select all by default
				for (const inv of invoices) {
					selectedIds.add(inv.invoiceId);
				}
				toast.success(`S-au găsit ${invoices.length} facturi!`);
			} else {
				toast.info('Nu s-au găsit facturi pe pagina de billing.');
			}

			if (cookiesRefreshed) {
				toast.success(`Cookie-urile ${platformName} au fost reîmprospătate! Sync-ul automat va funcționa luna viitoare.`, {
					duration: 5000
				});
			}
		} catch (e) {
			status = 'error';
			errorMessage = e instanceof Error ? e.message : 'Eroare la extragere';
			toast.error(errorMessage);
		}
	}

	async function handleCancel() {
		if (sessionId) {
			await cancelScraperSession({ sessionId }).catch(() => {});
		}
		status = 'idle';
		sessionId = null;
		invoices = [];
		selectedIds.clear();
		cookiesRefreshed = false;
		errorMessage = '';
	}

	async function handleImportSelected() {
		if (!onImport) {
			// Copy as JSON to clipboard
			const selected = invoices.filter(inv => selectedIds.has(inv.invoiceId));
			const json = JSON.stringify(selected, null, 2);
			await navigator.clipboard.writeText(json);
			toast.success(`${selected.length} facturi copiate în clipboard (JSON). Lipește în Import Facturi.`);
			return;
		}

		importing = true;
		try {
			const selected = invoices.filter(inv => selectedIds.has(inv.invoiceId));
			await onImport(selected);
			toast.success(`${selected.length} facturi importate cu succes!`);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la import');
		} finally {
			importing = false;
		}
	}

	function toggleInvoice(id: string) {
		if (selectedIds.has(id)) {
			selectedIds.delete(id);
		} else {
			selectedIds.add(id);
		}
	}

	function toggleAll() {
		if (selectedIds.size === invoices.length) {
			selectedIds.clear();
		} else {
			for (const inv of invoices) {
				selectedIds.add(inv.invoiceId);
			}
		}
	}

	function formatDate(date: string): string {
		try {
			return new Date(date + 'T00:00:00').toLocaleDateString('ro-RO', {
				day: 'numeric',
				month: 'short',
				year: 'numeric'
			});
		} catch {
			return date;
		}
	}
</script>

{#if status === 'idle'}
	{#if showTrigger}
		<!-- Just a button, shown alongside other actions -->
		<Button variant="outline" size="sm" onclick={handleStartScraper}>
			<MonitorIcon class="mr-2 h-4 w-4" />
			Scan cu Browser
		</Button>
	{/if}
{:else}
	<!-- Expanded panel when scraper is active -->
	<Card class="p-4 space-y-3 border-blue-200 bg-blue-50/30">
		<div class="flex items-center justify-between">
			<div class="flex items-center gap-2">
				<MonitorIcon class="h-5 w-5 text-blue-600" />
				<span class="font-medium text-sm">Browser Scraper — {platformName}</span>
			</div>
			<Button variant="ghost" size="sm" onclick={handleCancel}>
				<XCircleIcon class="h-4 w-4 mr-1" />Anulează
			</Button>
		</div>

		{#if status === 'launching'}
			<div class="flex items-center gap-2 text-sm text-muted-foreground">
				<LoaderIcon class="h-4 w-4 animate-spin" />
				Se deschide browserul...
			</div>
		{/if}

		{#if status === 'waiting_login' || status === 'checking_login'}
			<div class="space-y-2">
				<p class="text-sm">
					Browserul s-a deschis. Loghează-te în <strong>{platformName}</strong> și apoi apasă butonul de mai jos.
				</p>
				<Button
					size="sm"
					onclick={handleCheckLogin}
					disabled={status === 'checking_login'}
				>
					{#if status === 'checking_login'}
						<LoaderIcon class="mr-2 h-4 w-4 animate-spin" />Verific...
					{:else}
						<CheckCircleIcon class="mr-2 h-4 w-4" />Verifică Login & Extrage
					{/if}
				</Button>
			</div>
		{/if}

		{#if status === 'scraping'}
			<div class="space-y-1">
				<div class="flex items-center gap-2 text-sm text-muted-foreground">
					<LoaderIcon class="h-4 w-4 animate-spin" />
					Se extrag facturile din pagina de billing...
				</div>
				{#if platform === 'google'}
					<p class="text-xs text-muted-foreground ml-6">
						Se scanează automat toate sub-conturile. Poate dura 1-2 minute.
					</p>
				{/if}
			</div>
		{/if}

		{#if status === 'error'}
			<div class="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
				{errorMessage}
			</div>
			<Button variant="outline" size="sm" onclick={handleStartScraper}>
				Încearcă din nou
			</Button>
		{/if}

		{#if status === 'done'}
			{#if cookiesRefreshed}
				<div class="rounded-md bg-green-50 border border-green-200 p-3 text-sm text-green-700 flex items-center gap-2">
					<CookieIcon class="h-4 w-4 flex-shrink-0" />
					Cookie-urile {platformName} au fost reîmprospătate! Sync-ul automat va funcționa luna viitoare.
				</div>
			{/if}

			{#if invoices.length === 0}
				<p class="text-sm text-muted-foreground">Nu s-au găsit facturi pe pagina de billing.</p>
			{:else}
				<div class="space-y-2">
					<div class="flex items-center justify-between">
						<p class="text-sm font-medium">{invoices.length} facturi găsite</p>
						<div class="flex items-center gap-2">
							<Button variant="outline" size="sm" onclick={toggleAll}>
								{selectedIds.size === invoices.length ? 'Deselectează tot' : 'Selectează tot'}
							</Button>
						</div>
					</div>

					<div class="rounded-md border max-h-[300px] overflow-y-auto">
						<table class="w-full text-sm">
							<thead class="bg-muted/50 sticky top-0">
								<tr>
									<th class="w-8 p-2"></th>
									<th class="text-left p-2">ID Factură</th>
									<th class="text-left p-2">Cont</th>
									<th class="text-left p-2">Data</th>
									<th class="text-right p-2">Sumă</th>
								</tr>
							</thead>
							<tbody>
								{#each invoices as inv}
									<tr class="border-t hover:bg-muted/30 cursor-pointer" onclick={() => toggleInvoice(inv.invoiceId)}>
										<td class="p-2">
											<Checkbox
												checked={selectedIds.has(inv.invoiceId)}
												onCheckedChange={() => toggleInvoice(inv.invoiceId)}
											/>
										</td>
										<td class="p-2 font-mono text-xs">
											{inv.invoiceNumber || inv.invoiceId}
										</td>
										<td class="p-2">
											{#if inv.accountId && inv.accountId !== 'unknown'}
												<span class="font-mono text-xs">{inv.accountId}</span>
												{#if inv.accountName}
													<br /><span class="text-xs text-muted-foreground">{inv.accountName}</span>
												{/if}
											{:else if inv.accountName}
												<span class="text-xs">{inv.accountName}</span>
											{:else}
												<span class="text-xs text-muted-foreground">—</span>
											{/if}
										</td>
										<td class="p-2">
											{formatDate(inv.date)}
										</td>
										<td class="p-2 text-right">
											{inv.amountText || (inv.amount ? `${(inv.amount / 100).toFixed(2)} ${inv.currencyCode || ''}` : '-')}
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>

					<div class="flex items-center gap-2">
						<Button
							size="sm"
							onclick={handleImportSelected}
							disabled={selectedIds.size === 0 || importing}
						>
							{#if importing}
								<LoaderIcon class="mr-2 h-4 w-4 animate-spin" />Import...
							{:else}
								{onImport ? `Importă ${selectedIds.size} facturi` : `Copiază ${selectedIds.size} facturi (JSON)`}
							{/if}
						</Button>
						<span class="text-xs text-muted-foreground">
							{selectedIds.size} din {invoices.length} selectate
						</span>
					</div>
				</div>
			{/if}
		{/if}
	</Card>
{/if}
