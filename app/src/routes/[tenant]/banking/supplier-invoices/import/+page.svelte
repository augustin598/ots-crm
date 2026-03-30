<script lang="ts">
	import {
		previewGmailInvoices,
		importSelectedInvoices,
		getGmailConnectionStatus
	} from '$lib/remotes/supplier-invoices.remote';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import { Badge } from '$lib/components/ui/badge';
	import { Separator } from '$lib/components/ui/separator';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Calendar } from '$lib/components/ui/calendar';
	import * as Popover from '$lib/components/ui/popover';
	import { formatAmount, type Currency } from '$lib/utils/currency';
	import { type DateValue } from '@internationalized/date';
	import { ArrowLeft, Search, Download, CheckCircle2, AlertCircle, Mail, Calendar as CalendarIcon } from '@lucide/svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';

	const tenantSlug = $derived(page.params.tenant);

	const statusQuery = getGmailConnectionStatus();
	const gmailStatus = $derived(statusQuery.current);
	const statusLoading = $derived(statusQuery.loading);

	// Step management
	let currentStep = $state<'config' | 'preview' | 'result'>('config');

	// Config step
	let dateFrom = $state('');
	let dateTo = $state('');
	let dateFromValue = $state<DateValue | undefined>(undefined);
	let dateToValue = $state<DateValue | undefined>(undefined);
	let dateFromOpen = $state(false);
	let dateToOpen = $state(false);
	let selectedParsers = $state<string[]>(['cpanel', 'whmcs', 'hetzner', 'google', 'ovh', 'digitalocean', 'aws', 'generic']);

	// Preview step
	let previews = $state<any[]>([]);
	let selectedIds = $state<Set<string>>(new Set());
	let searching = $state(false);
	let searchError = $state<string | null>(null);

	// Result step
	let importResult = $state<{ imported: number; skippedDuplicates: number; errors: string[] } | null>(null);
	let importing = $state(false);

	$effect(() => {
		if (dateFromValue) {
			dateFrom = `${dateFromValue.year}-${String(dateFromValue.month).padStart(2, '0')}-${String(dateFromValue.day).padStart(2, '0')}`;
		} else {
			dateFrom = '';
		}
	});
	$effect(() => {
		if (dateToValue) {
			dateTo = `${dateToValue.year}-${String(dateToValue.month).padStart(2, '0')}-${String(dateToValue.day).padStart(2, '0')}`;
		} else {
			dateTo = '';
		}
	});

	const parserOptions = [
		{ id: 'cpanel', label: 'cPanel/WHM' },
		{ id: 'whmcs', label: 'WHMCS' },
		{ id: 'hetzner', label: 'Hetzner' },
		{ id: 'google', label: 'Google' },
		{ id: 'ovh', label: 'OVH' },
		{ id: 'digitalocean', label: 'DigitalOcean' },
		{ id: 'aws', label: 'AWS' },
		{ id: 'generic', label: 'Altele (generic)' }
	];

	function toggleParser(id: string) {
		if (selectedParsers.includes(id)) {
			selectedParsers = selectedParsers.filter((p) => p !== id);
		} else {
			selectedParsers = [...selectedParsers, id];
		}
	}

	function toggleAll() {
		if (selectedIds.size === newPreviews.length) {
			selectedIds = new Set();
		} else {
			selectedIds = new Set(newPreviews.map((p) => p.gmailMessageId));
		}
	}

	function toggleSelect(id: string) {
		const next = new Set(selectedIds);
		if (next.has(id)) {
			next.delete(id);
		} else {
			next.add(id);
		}
		selectedIds = next;
	}

	// Only invoices not already imported
	const newPreviews = $derived(previews.filter((p) => !p.alreadyImported));
	const duplicatePreviews = $derived(previews.filter((p) => p.alreadyImported));

	async function handleSearch() {
		searching = true;
		searchError = null;

		try {
			const result = await previewGmailInvoices({
				parserIds: selectedParsers.length > 0 ? selectedParsers : undefined,
				dateFrom: dateFrom || undefined,
				dateTo: dateTo || undefined,
				maxResults: 100
			});

			previews = result.previews;
			selectedIds = new Set(newPreviews.map((p) => p.gmailMessageId));
			currentStep = 'preview';
		} catch (e) {
			searchError = e instanceof Error ? e.message : 'Eroare la căutare';
		} finally {
			searching = false;
		}
	}

	async function handleImport() {
		if (selectedIds.size === 0) return;

		importing = true;
		try {
			const result = await importSelectedInvoices({
				messageIds: Array.from(selectedIds)
			});
			importResult = result;
			currentStep = 'result';
		} catch (e) {
			searchError = e instanceof Error ? e.message : 'Eroare la import';
		} finally {
			importing = false;
		}
	}

	function formatDate(date: Date | string | null) {
		if (!date) return '-';
		return new Date(date).toLocaleDateString('ro-RO');
	}

	const statusLabel = (status: string | undefined) => {
		switch (status) {
			case 'paid': return 'Plătită';
			case 'unpaid': return 'Neplătită';
			case 'overdue': return 'Restantă';
			default: return 'În așteptare';
		}
	};
</script>

<div class="container mx-auto max-w-4xl py-8 px-4">
	<div class="mb-6">
		<Button variant="ghost" size="sm" onclick={() => goto(`/${tenantSlug}/banking/supplier-invoices`)}>
			<ArrowLeft class="h-4 w-4 mr-2" />
			Înapoi la facturi
		</Button>
	</div>

	<h1 class="text-2xl font-bold mb-2">Import Facturi din Gmail</h1>
	<p class="text-muted-foreground mb-6">Caută și importă facturile de la furnizori din inbox-ul tău Gmail.</p>

	<!-- Check Gmail connection -->
	{#if statusLoading}
		<Card>
			<CardContent class="py-8 text-center">
				<p class="text-muted-foreground">Se verifică conexiunea Gmail...</p>
			</CardContent>
		</Card>
	{:else if !gmailStatus?.connected}
		<Card>
			<CardContent class="py-8 text-center">
				<Mail class="h-12 w-12 mx-auto text-muted-foreground mb-4" />
				<p class="text-lg font-medium mb-2">Gmail neconectat</p>
				<p class="text-muted-foreground mb-4">Trebuie să conectezi Gmail înainte de a importa facturi.</p>
				<Button href="/{tenantSlug}/settings/gmail">
					Conectează Gmail
				</Button>
			</CardContent>
		</Card>
	{:else}
		<!-- Step indicators -->
		<div class="flex items-center gap-2 mb-6">
			<Badge variant={currentStep === 'config' ? 'default' : 'secondary'}>1. Configurare</Badge>
			<span class="text-muted-foreground">→</span>
			<Badge variant={currentStep === 'preview' ? 'default' : 'secondary'}>2. Preview</Badge>
			<span class="text-muted-foreground">→</span>
			<Badge variant={currentStep === 'result' ? 'default' : 'secondary'}>3. Rezultat</Badge>
		</div>

		{#if searchError}
			<div class="mb-4 rounded-md bg-red-50 border border-red-200 p-4 text-red-800">
				<AlertCircle class="h-4 w-4 inline mr-2" />
				{searchError}
			</div>
		{/if}

		<!-- Step 1: Config -->
		{#if currentStep === 'config'}
			<Card>
				<CardHeader>
					<CardTitle>Configurare Căutare</CardTitle>
					<CardDescription>Selectează furnizorii și perioada de căutare.</CardDescription>
				</CardHeader>
				<CardContent class="space-y-6">
					<div>
						<Label class="mb-2 block font-medium">Furnizori</Label>
						<div class="flex flex-wrap gap-3">
							{#each parserOptions as opt}
								<label class="flex items-center gap-2 cursor-pointer">
									<Checkbox
										checked={selectedParsers.includes(opt.id)}
										onCheckedChange={() => toggleParser(opt.id)}
									/>
									<span class="text-sm">{opt.label}</span>
								</label>
							{/each}
						</div>
					</div>

					<Separator />

					<div class="grid grid-cols-2 gap-4">
						<div class="space-y-1.5">
							<Label>De la data</Label>
							<Popover.Root bind:open={dateFromOpen}>
								<Popover.Trigger>
									{#snippet child({ props })}
										<Button {...props} variant="outline" class="h-9 w-full justify-start text-start font-normal text-sm">
											<CalendarIcon class="mr-2 h-3.5 w-3.5 shrink-0 opacity-50" />
											{dateFromValue
												? new Date(dateFrom + 'T00:00:00').toLocaleDateString('ro-RO', { day: '2-digit', month: 'short', year: 'numeric' })
												: 'Alege data'}
										</Button>
									{/snippet}
								</Popover.Trigger>
								<Popover.Content class="w-auto p-0" align="start">
									<Calendar type="single" bind:value={dateFromValue} onValueChange={() => (dateFromOpen = false)} locale="ro-RO" captionLayout="dropdown" />
								</Popover.Content>
							</Popover.Root>
						</div>
						<div class="space-y-1.5">
							<Label>Până la data</Label>
							<Popover.Root bind:open={dateToOpen}>
								<Popover.Trigger>
									{#snippet child({ props })}
										<Button {...props} variant="outline" class="h-9 w-full justify-start text-start font-normal text-sm">
											<CalendarIcon class="mr-2 h-3.5 w-3.5 shrink-0 opacity-50" />
											{dateToValue
												? new Date(dateTo + 'T00:00:00').toLocaleDateString('ro-RO', { day: '2-digit', month: 'short', year: 'numeric' })
												: 'Alege data'}
										</Button>
									{/snippet}
								</Popover.Trigger>
								<Popover.Content class="w-auto p-0" align="start">
									<Calendar type="single" bind:value={dateToValue} onValueChange={() => (dateToOpen = false)} locale="ro-RO" captionLayout="dropdown" />
								</Popover.Content>
							</Popover.Root>
						</div>
					</div>

					<Button onclick={handleSearch} disabled={searching || selectedParsers.length === 0}>
						<Search class="h-4 w-4 mr-2" />
						{searching ? 'Se caută...' : 'Caută Facturi'}
					</Button>
				</CardContent>
			</Card>
		{/if}

		<!-- Step 2: Preview -->
		{#if currentStep === 'preview'}
			<Card>
				<CardHeader>
					<CardTitle>Facturi Găsite ({previews.length})</CardTitle>
					<CardDescription>
						{newPreviews.length} noi, {duplicatePreviews.length} deja importate.
						Selectează facturile pe care vrei să le importezi.
					</CardDescription>
				</CardHeader>
				<CardContent>
					{#if newPreviews.length === 0}
						<div class="py-8 text-center">
							<p class="text-muted-foreground">Nu s-au găsit facturi noi de importat.</p>
							<Button variant="outline" class="mt-4" onclick={() => { currentStep = 'config'; }}>
								Înapoi la căutare
							</Button>
						</div>
					{:else}
						<div class="mb-4 flex items-center justify-between">
							<label class="flex items-center gap-2 cursor-pointer">
								<Checkbox
									checked={selectedIds.size === newPreviews.length}
									onCheckedChange={toggleAll}
								/>
								<span class="text-sm font-medium">Selectează tot ({selectedIds.size}/{newPreviews.length})</span>
							</label>
						</div>

						<div class="space-y-2 max-h-[500px] overflow-y-auto">
							{#each newPreviews as preview}
								<div
									class="border rounded-md p-3 flex items-start gap-3 hover:bg-muted/25 cursor-pointer"
									onclick={() => toggleSelect(preview.gmailMessageId)}
								>
									<Checkbox
										checked={selectedIds.has(preview.gmailMessageId)}
										onCheckedChange={() => toggleSelect(preview.gmailMessageId)}
									/>
									<div class="flex-1 min-w-0">
										<div class="flex items-center gap-2 mb-1">
											<span class="font-medium text-sm">{preview.parsed.supplierName}</span>
											<Badge variant="outline" class="text-xs">
												{preview.parsed.supplierType}
											</Badge>
											{#if preview.parsed.status}
												<Badge
													variant={preview.parsed.status === 'paid' ? 'success' : 'warning'}
													class="text-xs"
												>
													{statusLabel(preview.parsed.status)}
												</Badge>
											{/if}
										</div>
										<p class="text-sm text-muted-foreground truncate">{preview.subject}</p>
										<div class="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
											<span>{formatDate(preview.date)}</span>
											{#if preview.parsed.amount}
												<span class="font-mono">
													{formatAmount(preview.parsed.amount, (preview.parsed.currency || 'USD') as Currency)}
												</span>
											{/if}
											{#if preview.parsed.invoiceNumber}
												<span>#{preview.parsed.invoiceNumber}</span>
											{/if}
											{#if preview.hasPdf}
												<Badge variant="outline" class="text-xs">PDF</Badge>
											{/if}
										</div>
									</div>
								</div>
							{/each}
						</div>

						<Separator class="my-4" />

						<div class="flex items-center gap-2">
							<Button onclick={handleImport} disabled={importing || selectedIds.size === 0}>
								<Download class="h-4 w-4 mr-2" />
								{importing ? 'Se importă...' : `Importă ${selectedIds.size} facturi`}
							</Button>
							<Button variant="outline" onclick={() => { currentStep = 'config'; }}>
								Înapoi
							</Button>
						</div>
					{/if}
				</CardContent>
			</Card>
		{/if}

		<!-- Step 3: Result -->
		{#if currentStep === 'result' && importResult}
			<Card>
				<CardHeader>
					<CardTitle class="flex items-center gap-2">
						<CheckCircle2 class="h-5 w-5 text-green-500" />
						Import Finalizat
					</CardTitle>
				</CardHeader>
				<CardContent class="space-y-4">
					<div class="grid grid-cols-3 gap-4">
						<div class="text-center p-4 bg-green-50 rounded-md">
							<div class="text-2xl font-bold text-green-700">{importResult.imported}</div>
							<div class="text-sm text-green-600">Importate</div>
						</div>
						<div class="text-center p-4 bg-yellow-50 rounded-md">
							<div class="text-2xl font-bold text-yellow-700">{importResult.skippedDuplicates}</div>
							<div class="text-sm text-yellow-600">Duplicate (skip)</div>
						</div>
						<div class="text-center p-4 bg-red-50 rounded-md">
							<div class="text-2xl font-bold text-red-700">{importResult.errors.length}</div>
							<div class="text-sm text-red-600">Erori</div>
						</div>
					</div>

					{#if importResult.errors.length > 0}
						<div class="rounded-md bg-red-50 border border-red-200 p-4">
							<p class="font-medium text-red-800 mb-2">Erori:</p>
							<ul class="text-sm text-red-700 space-y-1">
								{#each importResult.errors as err}
									<li>• {err}</li>
								{/each}
							</ul>
						</div>
					{/if}

					<div class="flex gap-2">
						<Button href="/{tenantSlug}/banking/supplier-invoices">
							Vezi Facturile Importate
						</Button>
						<Button variant="outline" onclick={() => { currentStep = 'config'; importResult = null; }}>
							Import Nou
						</Button>
					</div>
				</CardContent>
			</Card>
		{/if}
	{/if}
</div>
