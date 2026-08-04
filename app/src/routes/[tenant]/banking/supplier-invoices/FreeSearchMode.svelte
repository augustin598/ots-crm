<script lang="ts">
	import { searchGmailForDownload } from '$lib/remotes/supplier-invoices.remote';
	import { Card, CardContent } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Input } from '$lib/components/ui/input';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Label } from '$lib/components/ui/label';
	import { Select, SelectContent, SelectItem, SelectTrigger } from '$lib/components/ui/select';
	import { MAX_ZIP_ITEMS, nextDayIso, pluralRo, previousMonthRange } from '$lib/utils/gmail-search';
	import { Download, Search } from '@lucide/svelte';
	import SenderExclusionsPanel from './SenderExclusionsPanel.svelte';
	import {
		formatDate,
		formatMoney,
		reportError,
		runZipDownload,
		singleDownloadUrl
	} from './gmail-tab-shared';

	interface Props {
		tenantSlug: string;
		/** Blochează comutatorul de mod cât rulează o operație lungă. */
		busy?: boolean;
	}

	let { tenantSlug, busy = $bindable(false) }: Props = $props();

	type SearchResponse = Awaited<ReturnType<typeof searchGmailForDownload>>;

	const defaultRange = previousMonthRange();

	let dateFrom = $state(defaultRange.from);
	let dateTo = $state(defaultRange.to);
	let searching = $state(false);
	let downloading = $state(false);
	let downloadBatch = $state<{ current: number; total: number } | null>(null);
	let onlyNotDownloaded = $state(false);
	let onlyKnownSuppliers = $state(false);
	let customEmailsText = $state('');
	let searchResult = $state<SearchResponse | null>(null);
	let selectedMessages = $state(new Set<string>());

	/** Plafonul cerut Gmail. Fără el vizibil, o lună cu peste 100 de PDF-uri pare completă. */
	const MAX_RESULT_OPTIONS = [100, 250, 500];
	let maxResults = $state(100);
	/** Plafonul cu care s-a făcut ULTIMA căutare — cu el comparăm `totalFound`. */
	let lastMaxResults = $state(100);

	$effect(() => {
		busy = searching || downloading;
	});

	const customEmails = $derived(
		customEmailsText
			.split(',')
			.map((value) => value.trim())
			.filter(Boolean)
	);

	/**
	 * `buildInvoiceSearchQuery` folosește `customEmails` DOAR pe ramura 'suppliers';
	 * pe 'all' interogarea rămâne `has:attachment filename:pdf`, deci adresele scrise
	 * de utilizator ar fi ignorate în tăcere. Când există adrese, trecem automat pe
	 * scope-ul care le respectă (și spunem asta în UI).
	 */
	const useSupplierScope = $derived(onlyKnownSuppliers || customEmails.length > 0);

	const visibleResults = $derived(
		(searchResult?.results ?? []).filter((result) => !onlyNotDownloaded || !result.downloadedAt)
	);

	/** La fel ca în modul „Documente lipsă”: descărcăm doar ce e vizibil. */
	const selectedVisibleResults = $derived(
		visibleResults.filter((result) => selectedMessages.has(result.gmailMessageId))
	);

	export async function handleSearch() {
		searching = true;
		const requested = maxResults;
		try {
			searchResult = await searchGmailForDownload({
				dateFrom: dateFrom || undefined,
				// `before:` din Gmail e EXCLUSIV: fără ziua următoare, facturile sosite chiar
				// în ultima zi a intervalului (abonamentele lunare!) n-ar fi găsite niciodată.
				dateTo: dateTo ? nextDayIso(dateTo) : undefined,
				scope: useSupplierScope ? 'suppliers' : 'all',
				customEmails: customEmails.length > 0 ? customEmails : undefined,
				maxResults: requested
			});
			lastMaxResults = requested;
			selectedMessages = new Set();
		} catch (err) {
			reportError('gmail_search_for_download', err, 'Căutarea în Gmail a eșuat', tenantSlug);
		} finally {
			searching = false;
		}
	}

	/** Apelată de tab când se cere „Caută manual” pentru o plată nepotrivită. */
	export async function searchRange(range: { from: string; to: string } | null) {
		if (range) {
			dateFrom = range.from;
			dateTo = range.to;
		}
		await handleSearch();
	}

	function toggleMessage(messageId: string) {
		const next = new Set(selectedMessages);
		if (next.has(messageId)) next.delete(messageId);
		else next.add(messageId);
		selectedMessages = next;
	}

	async function downloadSelected() {
		downloading = true;
		const delivered = await runZipDownload({
			tenantSlug,
			items: selectedVisibleResults.map((result) => ({ messageId: result.gmailMessageId })),
			onBatch: (progress) => (downloadBatch = progress)
		});
		downloading = false;
		// Badge-urile „Descărcată” vin din evidența de pe server — le reîmprospătăm
		if (delivered && searchResult) await handleSearch();
	}
</script>

<Card class="mb-4">
	<CardContent class="pt-4">
		<div class="flex flex-wrap items-end gap-4">
			<div>
				<Label class="text-xs" for="gmail-search-from">De la</Label>
				<Input id="gmail-search-from" type="date" bind:value={dateFrom} class="w-[160px]" />
			</div>
			<div>
				<Label class="text-xs" for="gmail-search-to">Până la</Label>
				<Input id="gmail-search-to" type="date" bind:value={dateTo} class="w-[160px]" />
			</div>
			<Button
				variant="outline"
				size="sm"
				onclick={() => {
					const range = previousMonthRange();
					dateFrom = range.from;
					dateTo = range.to;
				}}
			>
				Luna anterioară
			</Button>
			<div>
				<Label class="text-xs" for="gmail-search-limit">Limită</Label>
				<Select
					type="single"
					value={String(maxResults)}
					onValueChange={(value) => {
						if (value) maxResults = Number(value);
					}}
				>
					<SelectTrigger id="gmail-search-limit" class="w-[140px]">
						{maxResults} mesaje
					</SelectTrigger>
					<SelectContent>
						{#each MAX_RESULT_OPTIONS as option (option)}
							<SelectItem value={String(option)}>{option} mesaje</SelectItem>
						{/each}
					</SelectContent>
				</Select>
			</div>
			<div class="min-w-[220px] flex-1">
				<Label class="text-xs" for="gmail-search-custom">Adrese suplimentare (virgulă)</Label>
				<Input
					id="gmail-search-custom"
					placeholder="facturi@furnizor.ro, @altfurnizor.com"
					bind:value={customEmailsText}
				/>
			</div>
			<Button onclick={handleSearch} disabled={searching}>
				<Search class="mr-2 h-4 w-4" />
				{searching ? 'Se caută...' : 'Caută în Gmail'}
			</Button>
		</div>
		<div class="mt-3 flex flex-wrap items-center gap-4">
			<label class="flex cursor-pointer items-center gap-2 text-sm">
				<Checkbox
					checked={useSupplierScope}
					disabled={customEmails.length > 0}
					onCheckedChange={(value) => (onlyKnownSuppliers = value === true)}
				/>
				<span>Doar furnizori cunoscuți</span>
			</label>
			<label class="flex cursor-pointer items-center gap-2 text-sm">
				<Checkbox
					checked={onlyNotDownloaded}
					onCheckedChange={(value) => (onlyNotDownloaded = value === true)}
				/>
				<span>Doar nedescărcate</span>
			</label>
		</div>
		<p class="mt-3 text-xs text-muted-foreground">
			{#if customEmails.length > 0}
				Adresele suplimentare funcționează doar împreună cu „Doar furnizori cunoscuți”, așa că am
				bifat-o automat: căutăm la furnizorii cu parser plus {pluralRo(
					customEmails.length,
					'adresa scrisă de tine',
					'adresele scrise de tine'
				)}. Golește câmpul ca să cauți din nou la orice expeditor.
			{:else if onlyKnownSuppliers}
				Căutarea acoperă doar furnizorii cu parser și adresele suplimentare de mai sus.
			{:else}
				Căutarea acoperă orice expeditor cu factură PDF în intervalul ales.
			{/if}
		</p>

		<SenderExclusionsPanel {tenantSlug} />
	</CardContent>
</Card>

{#if searchResult}
	<div class="mb-3 flex flex-wrap items-center justify-between gap-2">
		<div class="text-sm text-muted-foreground">
			<p>
				{pluralRo(visibleResults.length, 'email cu factură PDF', 'emailuri cu facturi PDF')}
				{#if visibleResults.length !== searchResult.results.length}
					(din {searchResult.results.length})
				{/if}
				· {pluralRo(searchResult.totalFound, 'mesaj scanat', 'mesaje scanate')}
				{#if searchResult.excludedCount > 0}
					· {pluralRo(searchResult.excludedCount, 'email sărit', 'emailuri sărite')} prin excluderi
				{/if}
			</p>
			{#if searchResult.totalFound >= lastMaxResults}
				<p class="mt-0.5 font-medium text-amber-600 dark:text-amber-500">
					Am scanat primele {pluralRo(lastMaxResults, 'mesaj', 'mesaje')} — exact plafonul cerut, deci
					pot exista și altele necuprinse. Restrânge intervalul sau crește limita.
				</p>
			{/if}
		</div>
		<div class="text-right">
			<div class="flex justify-end gap-2">
				<Button
					variant="outline"
					size="sm"
					disabled={visibleResults.length === 0}
					onclick={() =>
						(selectedMessages = new Set(visibleResults.map((result) => result.gmailMessageId)))}
				>
					Selectează tot
				</Button>
				<Button
					size="sm"
					disabled={downloading || selectedVisibleResults.length === 0}
					onclick={downloadSelected}
				>
					<Download class="mr-2 h-4 w-4" />
					{#if downloading && downloadBatch && downloadBatch.total > 1}
						Se descarcă... (arhiva {downloadBatch.current} din {downloadBatch.total})
					{:else if downloading}
						Se descarcă...
					{:else}
						Descarcă selecția ({selectedVisibleResults.length})
					{/if}
				</Button>
			</div>
			{#if selectedVisibleResults.length > MAX_ZIP_ITEMS}
				<p class="mt-1 text-xs text-muted-foreground">
					Maximum {MAX_ZIP_ITEMS} de emailuri pe arhivă — descărcăm în {Math.ceil(
						selectedVisibleResults.length / MAX_ZIP_ITEMS
					)} arhive.
				</p>
			{/if}
		</div>
	</div>

	{#if visibleResults.length === 0}
		<Card>
			<CardContent class="py-10 text-center text-muted-foreground">
				Niciun email cu factură PDF în intervalul ales.
			</CardContent>
		</Card>
	{:else}
		<Card>
			<CardContent class="p-0">
				<div class="overflow-x-auto">
					<table class="w-full text-sm">
						<thead>
							<tr class="border-b bg-muted/50">
								<th class="w-10 p-3"></th>
								<th class="p-3 text-left font-medium">Expeditor / Subiect</th>
								<th class="p-3 text-left font-medium">Data</th>
								<th class="p-3 text-right font-medium">Sumă</th>
								<th class="p-3 text-left font-medium">Status</th>
								<th class="p-3 text-right font-medium">Acțiuni</th>
							</tr>
						</thead>
						<tbody>
							{#each visibleResults as result (result.gmailMessageId)}
								<tr class="border-b hover:bg-muted/25">
									<td class="p-3">
										<Checkbox
											checked={selectedMessages.has(result.gmailMessageId)}
											onCheckedChange={() => toggleMessage(result.gmailMessageId)}
											aria-label="Selectează emailul {result.subject}"
										/>
									</td>
									<td class="max-w-[320px] p-3">
										<div class="truncate font-medium">{result.subject}</div>
										<div class="truncate text-xs text-muted-foreground">{result.from}</div>
									</td>
									<td class="p-3 whitespace-nowrap">{formatDate(result.date)}</td>
									<td class="p-3 text-right font-mono">
										{formatMoney(result.amount, result.currency)}
									</td>
									<td class="p-3">
										<div class="flex flex-wrap gap-1">
											{#if result.alreadyImported}
												<Badge variant="outline">Importată</Badge>
											{/if}
											{#if result.downloadedAt}
												<Badge variant="secondary">
													Descărcată {formatDate(result.downloadedAt)}
												</Badge>
											{/if}
										</div>
									</td>
									<td class="p-3 text-right">
										<div class="flex items-center justify-end gap-1">
											<!-- Filă nouă: o eroare Gmail (409/404/502) răspunde cu pagina HTML de
											     eroare, iar în aceeași filă ar demonta tabul cu tot cu rezultate. -->
											{#each result.pdfAttachments as attachment (attachment.index)}
												<Button
													variant="ghost"
													size="sm"
													title={attachment.filename}
													target="_blank"
													rel="noopener"
													data-sveltekit-reload
													href={singleDownloadUrl(
														tenantSlug,
														result.gmailMessageId,
														attachment.index
													)}
												>
													<Download class="h-4 w-4" />
												</Button>
											{/each}
										</div>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</CardContent>
		</Card>
	{/if}
{/if}
