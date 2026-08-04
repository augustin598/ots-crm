<script lang="ts">
	import { matchMissingDocuments } from '$lib/remotes/supplier-invoices.remote';
	import {
		Card,
		CardContent,
		CardDescription,
		CardHeader,
		CardTitle
	} from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { formatAmount } from '$lib/utils/currency';
	import {
		MAX_ZIP_ITEMS,
		MISSING_DOCS_SCAN_LIMIT,
		paymentLabel,
		pluralRo,
		toIsoDate
	} from '$lib/utils/gmail-search';
	import { Download, Search } from '@lucide/svelte';
	import XlsxDropZone from './XlsxDropZone.svelte';
	import {
		confidenceBadge,
		confidenceLabel,
		formatDate,
		formatMoney,
		reportError,
		runZipDownload,
		singleDownloadUrl,
		toBase64
	} from './gmail-tab-shared';

	interface Props {
		tenantSlug: string;
		/** Blochează comutatorul de mod cât rulează o operație lungă. */
		busy?: boolean;
		/** Trece în „Căutare liberă” pe fereastra din jurul plății. */
		onSearchAround: (range: { from: string; to: string } | null) => void;
	}

	let { tenantSlug, busy = $bindable(false), onSearchAround }: Props = $props();

	type MatchResponse = Awaited<ReturnType<typeof matchMissingDocuments>>;
	type MatchedPayment = MatchResponse['payments'][number];

	let uploading = $state(false);
	let elapsedSeconds = $state(0);
	let uploadedFileName = $state<string | null>(null);
	let matchResult = $state<MatchResponse | null>(null);
	/** Cheia unei selecții = indexul rândului + referința + mesajul Gmail potrivit. */
	let selectedPayments = $state(new Set<string>());
	/**
	 * Mesajele descărcate ÎN ACEASTĂ SESIUNE. Rezultatul potrivirii e înghețat în
	 * client (`matchMeta.downloadedAt` e calculat la scanare), iar rescanarea costă
	 * minute — fără evidența asta, a doua apăsare ar redescărca exact aceleași facturi.
	 */
	let downloadedNow = $state(new Map<string, Date>());
	let onlyNotDownloadedMatches = $state(false);
	let onlyMissingMatches = $state(false);
	let downloading = $state(false);
	/** Tranșa curentă, când selecția depășește plafonul endpointului. */
	let downloadBatch = $state<{ current: number; total: number } | null>(null);

	$effect(() => {
		busy = uploading || downloading;
	});

	const matchRows = $derived(
		((matchResult?.payments ?? []) as MatchedPayment[]).map((payment, index) => ({
			payment,
			rowKey: `${index}:${payment.reference}`,
			selectionKey: payment.match
				? `${index}:${payment.reference}:${payment.match.gmailMessageId}`
				: null
		}))
	);

	type MatchRow = (typeof matchRows)[number];

	/** Descărcată fie la o sesiune anterioară (evidența din DB), fie acum. */
	function rowDownloadedAt(row: MatchRow): Date | string | null {
		const messageId = row.payment.match?.gmailMessageId;
		if (!messageId) return null;
		return downloadedNow.get(messageId) ?? row.payment.matchMeta?.downloadedAt ?? null;
	}

	const visibleMatchRows = $derived(
		matchRows.filter((row) => {
			if (onlyMissingMatches && row.payment.match) return false;
			if (onlyNotDownloadedMatches && rowDownloadedAt(row)) return false;
			return true;
		})
	);

	/**
	 * Selecția trimisă la descărcare se derivă din rândurile VIZIBILE: altfel un filtru
	 * activat după bifare ar descărca facturi pe care utilizatorul nu le mai vede.
	 */
	const selectedRows = $derived(
		visibleMatchRows.filter(
			(row) => row.selectionKey !== null && selectedPayments.has(row.selectionKey)
		)
	);

	const matchCounts = $derived({
		sure: matchRows.filter((row) => row.payment.confidence === 'sure').length,
		probable: matchRows.filter((row) => row.payment.confidence === 'probable').length,
		none: matchRows.filter((row) => !row.payment.match).length
	});

	/**
	 * Cronometru pentru cea mai lungă operație din flux (până la 200 de emailuri, cu
	 * descărcare și parsare de PDF-uri). Nu e polling de date — doar progres vizibil.
	 */
	$effect(() => {
		if (!uploading) return;
		elapsedSeconds = 0;
		const startedAt = Date.now();
		const timer = setInterval(() => {
			elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);
		}, 1000);
		return () => clearInterval(timer);
	});

	const elapsedLabel = $derived(
		elapsedSeconds < 60
			? `${elapsedSeconds}s`
			: `${Math.floor(elapsedSeconds / 60)}m ${String(elapsedSeconds % 60).padStart(2, '0')}s`
	);

	async function handleFile(file: File) {
		uploading = true;
		try {
			const base64 = toBase64(await file.arrayBuffer());
			const result = await matchMissingDocuments({ fileBase64: base64 });
			matchResult = result;
			uploadedFileName = file.name;
			downloadedNow = new Map();
			// Pre-bifăm doar potrivirile sigure care NU au fost deja descărcate — evidența
			// de descărcare există exact ca să nu descărcăm de două ori aceeași lună.
			const preselected = new Set<string>();
			(result.payments as MatchedPayment[]).forEach((payment, index) => {
				if (payment.confidence === 'sure' && payment.match && !payment.matchMeta?.downloadedAt) {
					preselected.add(`${index}:${payment.reference}:${payment.match.gmailMessageId}`);
				}
			});
			selectedPayments = preselected;
		} catch (err) {
			reportError('gmail_match_missing_documents', err, 'Potrivirea documentelor a eșuat', tenantSlug);
		} finally {
			uploading = false;
		}
	}

	function togglePayment(key: string) {
		const next = new Set(selectedPayments);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		selectedPayments = next;
	}

	async function downloadSelectedMatches() {
		const rows = selectedRows;
		if (rows.length === 0) return;
		downloading = true;
		const delivered = await runZipDownload({
			tenantSlug,
			items: rows.map((row) => ({
				messageId: row.payment.match?.gmailMessageId ?? '',
				label: paymentLabel(row.payment),
				bankReference: row.payment.reference
			})),
			onBatch: (progress) => (downloadBatch = progress)
		});
		downloading = false;
		if (!delivered) return;
		// Evidența reală se scrie pe server (`recordDownload`), dar rezultatul potrivirii
		// din client e înghețat: marcăm rândurile aici și golim selecția.
		const now = new Date();
		const next = new Map(downloadedNow);
		for (const row of rows) {
			if (row.payment.match) next.set(row.payment.match.gmailMessageId, now);
		}
		downloadedNow = next;
		selectedPayments = new Set();
	}

	/** Fereastră calendaristică de ±10 zile în jurul plății, pentru căutarea manuală. */
	function requestSearchAround(payment: MatchedPayment) {
		const paid = payment.date ? new Date(payment.date) : null;
		if (!paid || isNaN(paid.getTime())) {
			onSearchAround(null);
			return;
		}
		// Construită fără mutații: constructorul normalizează depășirile de lună și nu
		// se lasă păcălit de trecerile de oră
		onSearchAround({
			from: toIsoDate(new Date(paid.getFullYear(), paid.getMonth(), paid.getDate() - 10)),
			to: toIsoDate(new Date(paid.getFullYear(), paid.getMonth(), paid.getDate() + 10))
		});
	}
</script>

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
		<XlsxDropZone
			fileName={uploadedFileName}
			disabled={uploading}
			busy={uploading}
			onFile={handleFile}
		/>
		<p class="mt-3 text-xs text-muted-foreground">
			Scanăm cel mult {pluralRo(MISSING_DOCS_SCAN_LIMIT, 'email', 'emailuri')} din fereastra
			plăților (±10 zile). Potrivirea unei luni întregi poate dura 1-3 minute — nu închide pagina
			cât rulează.
		</p>
	</CardContent>
</Card>

{#if uploading}
	<Card class="mb-4 border-amber-500/40">
		<CardContent class="py-4">
			<p class="text-sm font-medium">
				Se caută facturile în Gmail… ({elapsedLabel})
			</p>
			<p class="mt-1 text-xs text-muted-foreground">
				Deschidem fiecare email și, când suma lipsește din text, și PDF-ul atașat. Nu închide
				pagina și nu schimba tabul — rezultatul se pierde.
			</p>
			<div class="mt-3 h-1.5 w-full overflow-hidden rounded bg-muted">
				<div class="h-full w-1/3 animate-pulse rounded bg-primary"></div>
			</div>
		</CardContent>
	</Card>
{/if}

{#if matchResult}
	<div class="mb-3 flex flex-wrap items-center justify-between gap-2">
		<div class="text-sm text-muted-foreground">
			<p>
				{pluralRo(matchRows.length, 'plată', 'plăți')} · {pluralRo(
					matchResult.candidatesFound,
					'factură găsită în Gmail',
					'facturi găsite în Gmail'
				)}
				· {pluralRo(matchResult.totalFound, 'mesaj scanat', 'mesaje scanate')}
				{#if matchResult.ignoredIncomes > 0}
					· {pluralRo(matchResult.ignoredIncomes, 'încasare ignorată', 'încasări ignorate')}
				{/if}
				{#if matchResult.excludedCount > 0}
					· {pluralRo(matchResult.excludedCount, 'email sărit', 'emailuri sărite')} prin excluderi
				{/if}
			</p>
			<!--
				Trunchiere: Gmail a întors exact cât am cerut, deci pot exista mesaje necuprinse.
				Fără avertismentul ăsta, o plată a cărei factură a rămas dincolo de plafon arată
				identic cu un document care chiar lipsește — și se caută manual degeaba.
			-->
			{#if matchResult.totalFound >= matchResult.scanLimit}
				<p class="mt-0.5 font-medium text-amber-600 dark:text-amber-500">
					Am scanat primele {pluralRo(matchResult.scanLimit, 'mesaj', 'mesaje')} — exact plafonul,
					deci pot exista facturi necuprinse, iar unele plăți pot apărea greșit drept „fără
					factură”. Restrânge intervalul exportului „Documente Lipsa” din Keez (o lună) și încarcă
					fișierul din nou.
				</p>
			{/if}
			{#if matchResult.invalidDates > 0}
				<p class="mt-0.5 font-medium text-amber-600 dark:text-amber-500">
					{pluralRo(
						matchResult.invalidDates,
						'plată cu dată necitită',
						'plăți cu dată necitită'
					)} — rândurile acestea nu se pot potrivi cu nicio factură. Exportă din nou din Keez, cu
					data ca dată calendaristică, nu ca text.
				</p>
			{/if}
			{#if matchRows.length > 0}
				<p class="mt-0.5">
					{pluralRo(matchCounts.sure, 'potrivire sigură', 'potriviri sigure')} · {pluralRo(
						matchCounts.probable,
						'potrivire probabilă',
						'potriviri probabile'
					)} · {pluralRo(matchCounts.none, 'plată fără factură', 'plăți fără factură')}
				</p>
			{/if}
		</div>
		<div class="text-right">
			<Button
				size="sm"
				disabled={downloading || selectedRows.length === 0}
				onclick={downloadSelectedMatches}
			>
				<Download class="mr-2 h-4 w-4" />
				{#if downloading && downloadBatch && downloadBatch.total > 1}
					Se descarcă... (arhiva {downloadBatch.current} din {downloadBatch.total})
				{:else if downloading}
					Se descarcă...
				{:else}
					Descarcă selecția ({selectedRows.length})
				{/if}
			</Button>
			{#if selectedRows.length > MAX_ZIP_ITEMS}
				<p class="mt-1 text-xs text-muted-foreground">
					Maximum {MAX_ZIP_ITEMS} de emailuri pe arhivă — descărcăm în {Math.ceil(
						selectedRows.length / MAX_ZIP_ITEMS
					)} arhive.
				</p>
			{/if}
		</div>
	</div>

	{#if matchRows.length > 0}
		<div class="mb-3 flex flex-wrap items-center gap-4">
			<label class="flex cursor-pointer items-center gap-2 text-sm">
				<Checkbox
					checked={onlyNotDownloadedMatches}
					onCheckedChange={(value) => (onlyNotDownloadedMatches = value === true)}
				/>
				<span>Doar nedescărcate</span>
			</label>
			<label class="flex cursor-pointer items-center gap-2 text-sm">
				<Checkbox
					checked={onlyMissingMatches}
					onCheckedChange={(value) => (onlyMissingMatches = value === true)}
				/>
				<span>Doar plățile fără factură</span>
			</label>
			{#if visibleMatchRows.length !== matchRows.length}
				<span class="text-xs text-muted-foreground">
					{visibleMatchRows.length} din {matchRows.length} rânduri afișate
				</span>
			{/if}
		</div>
	{/if}

	{#if matchRows.length === 0}
		<Card>
			<CardContent class="py-10 text-center">
				<p class="font-medium">
					Nu am găsit niciun rând de tip „Plati fara document” în acest fișier.
				</p>
				<p class="mt-1 text-sm text-muted-foreground">
					Verifică dacă e exportul „Documente Lipsa” din Keez și dacă are selectată foaia
					corectă{#if matchResult.ignoredIncomes > 0}
						— am citit doar {pluralRo(
							matchResult.ignoredIncomes,
							'încasare fără document',
							'încasări fără document'
						)}, pe care fluxul le ignoră{/if}.
				</p>
			</CardContent>
		</Card>
	{:else if visibleMatchRows.length === 0}
		<Card>
			<CardContent class="py-10 text-center text-muted-foreground">
				Niciun rând nu trece de filtrele alese.
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
							{#each visibleMatchRows as row (row.rowKey)}
								{@const payment = row.payment}
								{@const selectionKey = row.selectionKey}
								{@const downloadedAt = rowDownloadedAt(row)}
								<tr class="border-b hover:bg-muted/25 {payment.match ? '' : 'bg-destructive/5'}">
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
											{#if downloadedNow.has(payment.match.gmailMessageId)}
												<Badge variant="secondary" class="mt-1">Descărcată acum</Badge>
											{:else if downloadedAt}
												<Badge variant="secondary" class="mt-1">
													Descărcată {formatDate(downloadedAt)}
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
											<div class="flex items-center justify-end gap-1">
												<!-- Un email poate avea mai multe PDF-uri (factură + anexă): le
												     oferim pe toate, ca în căutarea liberă. Filă nouă, ca o
												     eroare Gmail să nu înghită rezultatul potrivirii. -->
												{#each payment.matchMeta.pdfAttachments as attachment (attachment.index)}
													<Button
														variant="ghost"
														size="sm"
														title={attachment.filename}
														target="_blank"
														rel="noopener"
														data-sveltekit-reload
														href={singleDownloadUrl(
															tenantSlug,
															payment.match.gmailMessageId,
															attachment.index,
															payment.reference
														)}
													>
														<Download class="h-4 w-4" />
													</Button>
												{/each}
											</div>
										{:else if !payment.match}
											<Button
												variant="outline"
												size="sm"
												onclick={() => requestSearchAround(payment)}
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
