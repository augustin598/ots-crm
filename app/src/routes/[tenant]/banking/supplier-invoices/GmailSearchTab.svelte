<script lang="ts">
	import {
		searchGmailForDownload,
		matchMissingDocuments,
		getGmailConnectionStatus
	} from '$lib/remotes/supplier-invoices.remote';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Input } from '$lib/components/ui/input';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Label } from '$lib/components/ui/label';
	import { formatAmount, CURRENCIES, type Currency } from '$lib/utils/currency';
	import { Download, Search, Upload, FileSpreadsheet, AlertCircle } from '@lucide/svelte';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import { clientLogger } from '$lib/client-logger';

	const tenantSlug = $derived(page.params.tenant);

	const statusQuery = getGmailConnectionStatus();
	const gmailStatus = $derived(statusQuery.current);

	type MatchResponse = Awaited<ReturnType<typeof matchMissingDocuments>>;
	type MatchedPayment = MatchResponse['payments'][number];
	type SearchResponse = Awaited<ReturnType<typeof searchGmailForDownload>>;

	// ---- Mod: 'upload' (Documente Lipsă din Keez) | 'search' (căutare liberă) ----
	let mode = $state<'upload' | 'search'>('upload');

	// ---- Mod A: încărcare „Documente Lipsa” ----
	let uploading = $state(false);
	let matchResult = $state<MatchResponse | null>(null);
	/** Cheia unei selecții = indexul rândului + referința + mesajul Gmail potrivit. */
	let selectedPayments = $state(new Set<string>());

	const matchRows = $derived(
		((matchResult?.payments ?? []) as MatchedPayment[]).map((payment, index) => ({
			payment,
			rowKey: `${index}:${payment.reference}`,
			selectionKey: payment.match
				? `${index}:${payment.reference}:${payment.match.gmailMessageId}`
				: null
		}))
	);

	const selectedRows = $derived(
		matchRows.filter((row) => row.selectionKey !== null && selectedPayments.has(row.selectionKey))
	);

	/** btoa pe felii — String.fromCharCode(...) pe tot bufferul poate depăși stiva. */
	function toBase64(buffer: ArrayBuffer): string {
		const bytes = new Uint8Array(buffer);
		const CHUNK = 8192;
		let binary = '';
		for (let i = 0; i < bytes.length; i += CHUNK) {
			binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
		}
		return btoa(binary);
	}

	async function handleFileChange(
		event: Event & { currentTarget: EventTarget & HTMLInputElement }
	) {
		const input = event.currentTarget;
		const file = input.files?.[0];
		if (!file) return;
		uploading = true;
		try {
			const base64 = toBase64(await file.arrayBuffer());
			const result = await matchMissingDocuments({ fileBase64: base64 });
			matchResult = result;
			// Pre-bifăm doar potrivirile sigure
			const preselected = new Set<string>();
			(result.payments as MatchedPayment[]).forEach((payment, index) => {
				if (payment.confidence === 'sure' && payment.match) {
					preselected.add(`${index}:${payment.reference}:${payment.match.gmailMessageId}`);
				}
			});
			selectedPayments = preselected;
		} catch (err) {
			clientLogger.apiError('gmail_match_missing_documents', err);
		} finally {
			uploading = false;
			input.value = '';
		}
	}

	function togglePayment(key: string) {
		const next = new Set(selectedPayments);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		selectedPayments = next;
	}

	/** Cuvinte care nu sunt niciodată numele comerciantului în descrierea bancară. */
	const LABEL_STOPWORDS = new Set([
		'PLATA',
		'CARD',
		'VISA',
		'EPOS',
		'TRANZACTIE',
		'VALOARE',
		'COMISION',
		'ONLINE',
		'PAYMENT',
		'INVOICE',
		'FACTURA',
		'GMBH',
		'LIMITED',
		'TECHNOLOGIES'
	]);

	/** Numele scurt al comerciantului, pentru numele fișierului descărcat. */
	function merchantShort(payment: MatchedPayment): string {
		const fromPartner = (payment.partner || '').replace(/[^a-zA-Z0-9]+/g, '').toUpperCase();
		if (fromPartner.length >= 3) return fromPartner.slice(0, 20);
		const token = (payment.comment || '')
			.toUpperCase()
			.split(/\s+/)
			.filter((raw) => !/\d/.test(raw))
			.flatMap((raw) => raw.split(/[^A-Z]+/))
			.find((word) => word.length >= 5 && !LABEL_STOPWORDS.has(word));
		return token ? token.slice(0, 20) : 'FURNIZOR';
	}

	/** Prefixul fișierului din ZIP: referință + comerciant + suma (mereu cu valută). */
	function paymentLabel(payment: MatchedPayment): string {
		const amount =
			payment.originalAmount != null && payment.originalCurrency
				? `${(payment.originalAmount / 100).toFixed(2)}${payment.originalCurrency}`
				: `${(payment.amountRon / 100).toFixed(2)}RON`;
		return `${payment.reference}_${merchantShort(payment)}_${amount}`;
	}

	// ---- Mod B: căutare liberă ----
	// Implicit: luna calendaristică ANTERIOARĂ (fluxul e lunar — facturile lunii trecute
	// se urcă în Keez la începutul lunii curente). Derivat din data curentă, niciodată hardcodat.
	function previousMonthRange(): { from: string; to: string } {
		const now = new Date();
		const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
		const last = new Date(now.getFullYear(), now.getMonth(), 0);
		return { from: toIsoDate(first), to: toIsoDate(last) };
	}

	function toIsoDate(date: Date): string {
		return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
	}

	const defaultRange = previousMonthRange();

	let dateFrom = $state(defaultRange.from);
	let dateTo = $state(defaultRange.to);
	let searching = $state(false);
	let onlyNotDownloaded = $state(false);
	let onlyKnownSuppliers = $state(false);
	let customEmailsText = $state('');
	let searchResult = $state<SearchResponse | null>(null);
	let selectedMessages = $state(new Set<string>());

	const visibleResults = $derived(
		(searchResult?.results ?? []).filter((result) => !onlyNotDownloaded || !result.downloadedAt)
	);

	async function handleSearch() {
		searching = true;
		try {
			const customEmails = customEmailsText
				.split(',')
				.map((value) => value.trim())
				.filter(Boolean);
			searchResult = await searchGmailForDownload({
				dateFrom: dateFrom || undefined,
				dateTo: dateTo || undefined,
				scope: onlyKnownSuppliers ? 'suppliers' : 'all',
				customEmails: customEmails.length > 0 ? customEmails : undefined,
				maxResults: 100
			});
			selectedMessages = new Set();
		} catch (err) {
			clientLogger.apiError('gmail_search_for_download', err);
		} finally {
			searching = false;
		}
	}

	function toggleMessage(messageId: string) {
		const next = new Set(selectedMessages);
		if (next.has(messageId)) next.delete(messageId);
		else next.add(messageId);
		selectedMessages = next;
	}

	/** Trece în modul „căutare liberă” cu fereastra de ±10 zile în jurul plății. */
	async function searchAroundPayment(payment: MatchedPayment) {
		const paid = payment.date ? new Date(payment.date) : null;
		if (paid && !isNaN(paid.getTime())) {
			// Fereastră calendaristică de ±10 zile, construită fără mutații (constructorul
			// normalizează depășirile de lună și nu se lasă păcălit de trecerile de oră)
			dateFrom = toIsoDate(new Date(paid.getFullYear(), paid.getMonth(), paid.getDate() - 10));
			dateTo = toIsoDate(new Date(paid.getFullYear(), paid.getMonth(), paid.getDate() + 10));
		}
		mode = 'search';
		await handleSearch();
	}

	// ---- Descărcare comună ----
	let downloading = $state(false);

	async function downloadZip(
		items: Array<{ messageId: string; label?: string; bankReference?: string }>
	) {
		if (items.length === 0) return;
		downloading = true;
		try {
			const res = await fetch(`/${tenantSlug}/banking/supplier-invoices/download-gmail-zip`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ items })
			});
			if (!res.ok) throw new Error((await res.text()) || 'Eroare la descărcare');
			const skippedCount = parseInt(res.headers.get('X-Skipped-Count') || '0', 10);
			const blob = await res.blob();
			const url = URL.createObjectURL(blob);
			const anchor = document.createElement('a');
			anchor.href = url;
			anchor.download =
				res.headers.get('Content-Disposition')?.match(/filename="(.+)"/)?.[1] ||
				'facturi-gmail.zip';
			document.body.appendChild(anchor);
			anchor.click();
			anchor.remove();
			URL.revokeObjectURL(url);
			if (skippedCount > 0) {
				toast.warning(`${skippedCount} emailuri sărite (fără PDF sau eroare)`);
			} else {
				toast.success('Arhiva a fost descărcată');
			}
			// Reîmprospătăm badge-urile „Descărcată”
			if (mode === 'search' && searchResult) await handleSearch();
		} catch (err) {
			clientLogger.apiError('gmail_download_zip', err);
		} finally {
			downloading = false;
		}
	}

	function singleDownloadUrl(messageId: string, index: number, bankReference?: string) {
		const params = new URLSearchParams({ messageId, index: String(index) });
		if (bankReference) params.set('ref', bankReference);
		return `/${tenantSlug}/banking/supplier-invoices/gmail-attachment?${params}`;
	}

	function formatDate(value: Date | string | null | undefined) {
		if (!value) return '—';
		const date = new Date(value);
		if (isNaN(date.getTime())) return 'dată invalidă';
		return date.toLocaleDateString('ro-RO');
	}

	const knownCurrencies = new Set<string>(CURRENCIES);

	/** Nicio sumă fără valută: fără valută cunoscută afișăm codul brut lângă valoare. */
	function formatMoney(cents: number | null | undefined, currency: string | null | undefined) {
		if (cents == null || !currency) return '—';
		if (knownCurrencies.has(currency)) return formatAmount(cents, currency as Currency);
		return `${(cents / 100).toFixed(2)} ${currency}`;
	}

	const confidenceBadge = (confidence: string) =>
		confidence === 'sure'
			? ('success' as const)
			: confidence === 'probable'
				? ('warning' as const)
				: ('secondary' as const);

	const confidenceLabel = (confidence: string) =>
		confidence === 'sure'
			? 'Potrivire sigură'
			: confidence === 'probable'
				? 'Probabilă'
				: 'Negăsită';
</script>

{#if gmailStatus && !gmailStatus.connected}
	<Card>
		<CardContent class="py-8 text-center">
			<AlertCircle class="mx-auto mb-2 h-8 w-8 text-amber-500" />
			<p class="font-medium">Gmail nu este conectat</p>
			<p class="text-sm text-muted-foreground">
				Configurează conexiunea din pagina de import înainte de a căuta facturi.
			</p>
			<Button class="mt-4" href="/{tenantSlug}/banking/supplier-invoices/import">
				Mergi la import
			</Button>
		</CardContent>
	</Card>
{:else}
	<div class="mb-4 flex flex-wrap gap-2">
		<Button
			variant={mode === 'upload' ? 'default' : 'outline'}
			size="sm"
			onclick={() => (mode = 'upload')}
		>
			<FileSpreadsheet class="mr-2 h-4 w-4" />
			Documente lipsă (Keez)
		</Button>
		<Button
			variant={mode === 'search' ? 'default' : 'outline'}
			size="sm"
			onclick={() => (mode = 'search')}
		>
			<Search class="mr-2 h-4 w-4" />
			Căutare liberă
		</Button>
	</div>

	{#if mode === 'upload'}
		<Card class="mb-4">
			<CardHeader>
				<CardTitle>Încarcă exportul „Documente Lipsa” din Keez</CardTitle>
				<CardDescription>
					XLSX-ul cu plățile fără document justificativ. Căutăm automat facturile în Gmail și le
					potrivim cu fiecare plată. Atenție: plățile apar în lei, dar potrivirea se face pe suma
					originală (EUR/USD) din descrierea tranzacției.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<label class="flex cursor-pointer items-center gap-3">
					<Upload class="h-4 w-4 shrink-0" />
					<span class="text-sm whitespace-nowrap">
						{uploading ? 'Se procesează...' : 'Alege fișierul XLSX'}
					</span>
					<Input
						type="file"
						accept=".xlsx"
						class="max-w-sm"
						disabled={uploading}
						onchange={handleFileChange}
					/>
				</label>
			</CardContent>
		</Card>

		{#if matchResult}
			<div class="mb-3 flex flex-wrap items-center justify-between gap-2">
				<p class="text-sm text-muted-foreground">
					{matchRows.length} plăți · {matchResult.candidatesFound} facturi găsite în Gmail
					{#if matchResult.ignoredIncomes > 0}
						· {matchResult.ignoredIncomes} încasări ignorate
					{/if}
				</p>
				<Button
					size="sm"
					disabled={downloading || selectedRows.length === 0}
					onclick={() =>
						downloadZip(
							selectedRows.map((row) => ({
								messageId: row.payment.match?.gmailMessageId ?? '',
								label: paymentLabel(row.payment),
								bankReference: row.payment.reference
							}))
						)}
				>
					<Download class="mr-2 h-4 w-4" />
					{downloading ? 'Se descarcă...' : `Descarcă selecția (${selectedRows.length})`}
				</Button>
			</div>

			{#if matchRows.length === 0}
				<Card>
					<CardContent class="py-10 text-center text-muted-foreground">
						Fișierul nu conține plăți fără document.
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
										<th class="p-3 text-left font-medium">Referință</th>
										<th class="p-3 text-left font-medium">Data plății</th>
										<th class="p-3 text-right font-medium">Sumă originală</th>
										<th class="p-3 text-right font-medium">Sumă în lei</th>
										<th class="p-3 text-left font-medium">Factura găsită</th>
										<th class="p-3 text-left font-medium">Potrivire</th>
										<th class="p-3 text-right font-medium">Acțiuni</th>
									</tr>
								</thead>
								<tbody>
									{#each matchRows as row (row.rowKey)}
										{@const payment = row.payment}
										{@const selectionKey = row.selectionKey}
										<tr
											class="border-b hover:bg-muted/25 {payment.match ? '' : 'bg-destructive/5'}"
										>
											<td class="p-3">
												{#if selectionKey}
													<Checkbox
														checked={selectedPayments.has(selectionKey)}
														onCheckedChange={() => togglePayment(selectionKey)}
														aria-label="Selectează plata {payment.reference}"
													/>
												{/if}
											</td>
											<td class="p-3 font-mono">{payment.reference}</td>
											<td class="p-3 whitespace-nowrap">{formatDate(payment.date)}</td>
											<td class="p-3 text-right font-mono">
												{formatMoney(payment.originalAmount, payment.originalCurrency)}
											</td>
											<td class="p-3 text-right font-mono">
												{formatAmount(payment.amountRon, 'RON')}
											</td>
											<td class="max-w-[280px] p-3">
												{#if payment.match}
													<div class="truncate font-medium">{payment.match.subject}</div>
													<div class="truncate text-xs text-muted-foreground">
														{payment.match.from} · {formatDate(payment.match.date)}
													</div>
													{#if payment.matchMeta?.downloadedAt}
														<Badge variant="secondary" class="mt-1">
															Descărcată {formatDate(payment.matchMeta.downloadedAt)}
														</Badge>
													{/if}
												{:else}
													<span class="text-muted-foreground">—</span>
												{/if}
											</td>
											<td class="p-3">
												<Badge variant={confidenceBadge(payment.confidence)}>
													{confidenceLabel(payment.confidence)}{payment.score
														? ` (${payment.score})`
														: ''}
												</Badge>
											</td>
											<td class="p-3 text-right">
												{#if payment.match && payment.matchMeta?.pdfAttachments?.length}
													<Button
														variant="ghost"
														size="sm"
														title="Descarcă PDF-ul"
														data-sveltekit-reload
														href={singleDownloadUrl(
															payment.match.gmailMessageId,
															payment.matchMeta.pdfAttachments[0].index,
															payment.reference
														)}
													>
														<Download class="h-4 w-4" />
													</Button>
												{:else if !payment.match}
													<Button
														variant="outline"
														size="sm"
														onclick={() => searchAroundPayment(payment)}
													>
														<Search class="mr-2 h-4 w-4" />
														Caută manual
													</Button>
												{/if}
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
	{:else}
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
							checked={onlyKnownSuppliers}
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
					{onlyKnownSuppliers
						? 'Căutarea acoperă doar furnizorii cu parser și adresele suplimentare de mai sus.'
						: 'Căutarea acoperă orice expeditor cu factură PDF în intervalul ales.'}
				</p>
			</CardContent>
		</Card>

		{#if searchResult}
			<div class="mb-3 flex flex-wrap items-center justify-between gap-2">
				<p class="text-sm text-muted-foreground">
					{visibleResults.length} emailuri cu facturi PDF
					{#if visibleResults.length !== searchResult.results.length}
						(din {searchResult.results.length})
					{/if}
				</p>
				<div class="flex gap-2">
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
						disabled={downloading || selectedMessages.size === 0}
						onclick={() => downloadZip([...selectedMessages].map((messageId) => ({ messageId })))}
					>
						<Download class="mr-2 h-4 w-4" />
						{downloading ? 'Se descarcă...' : `Descarcă selecția (${selectedMessages.size})`}
					</Button>
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
													{#each result.pdfAttachments as attachment (attachment.index)}
														<Button
															variant="ghost"
															size="sm"
															title={attachment.filename}
															data-sveltekit-reload
															href={singleDownloadUrl(result.gmailMessageId, attachment.index)}
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
	{/if}
{/if}
