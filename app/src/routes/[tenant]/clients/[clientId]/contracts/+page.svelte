<script lang="ts">
	import { getContracts, extractClientFromContract } from '$lib/remotes/contracts.remote';
	import { getClient, updateClient, getClients } from '$lib/remotes/clients.remote';
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { Card, CardContent } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import {
		Dialog,
		DialogContent,
		DialogHeader,
		DialogTitle,
		DialogFooter,
		DialogDescription
	} from '$lib/components/ui/dialog';
	import { FileText, Plus, ExternalLink, Upload, X, Loader2, CheckCircle2, AlertCircle, Info } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import { cn } from '$lib/utils';

	const fieldLabels: Record<string, string> = {
		cui: 'CUI',
		registrationNumber: 'Nr. Înregistrare',
		email: 'Email',
		phone: 'Telefon',
		address: 'Adresă',
		city: 'Oraș',
		county: 'Județ',
		postalCode: 'Cod Poștal',
		iban: 'IBAN',
		bankName: 'Bancă',
		legalRepresentative: 'Reprezentant Legal'
	};

	const tenantSlug = $derived(page.params.tenant);
	const clientId = $derived(page.params.clientId);

	const contractsQuery = getContracts({ clientId });
	const contracts = $derived(contractsQuery.current?.contracts || []);
	const loading = $derived(contractsQuery.loading);

	// Extraction report state
	let showExtractionReport = $state(false);
	let extractionReport = $state<{ extracted: Record<string, string>; updated: Record<string, string>; skipped: Record<string, string> } | null>(null);
	let updatingSkipped = $state(false);

	const clientQuery = getClient(clientId as string);

	async function handleUpdateSkippedFields() {
		if (!extractionReport || Object.keys(extractionReport.skipped).length === 0) return;
		updatingSkipped = true;
		try {
			const client = clientQuery.current;
			if (!client) throw new Error('Client not found');
			console.log('[ClientUpload] Updating skipped fields:', extractionReport.skipped);
			await updateClient({ clientId: clientId as string, name: client.name, ...extractionReport.skipped })
				.updates(clientQuery, getClient(clientId as string), getClients());
			// Move skipped to updated in report
			extractionReport = {
				extracted: extractionReport.extracted,
				updated: { ...extractionReport.updated, ...extractionReport.skipped },
				skipped: {}
			};
			toast.success('Datele clientului au fost actualizate');
		} catch (e) {
			console.error('[ClientUpload] Update skipped fields error:', e);
			toast.error(e instanceof Error ? e.message : 'Eroare la actualizare');
		} finally {
			updatingSkipped = false;
		}
	}

	// Upload modal state
	let showUploadModal = $state(false);
	let uploadFile = $state<File | null>(null);
	let uploadTitle = $state('');
	let uploadDate = $state('');
	let uploadNumber = $state('');
	let uploading = $state(false);
	let uploadError = $state<string | null>(null);
	let isDragging = $state(false);
	let fileInputRef: HTMLInputElement | null = $state(null);

	function getStatusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
		switch (status) {
			case 'signed':
				return 'default';
			case 'sent':
				return 'secondary';
			case 'draft':
				return 'outline';
			case 'cancelled':
				return 'destructive';
			default:
				return 'outline';
		}
	}

	function getStatusLabel(status: string): string {
		switch (status) {
			case 'draft':
				return 'Ciornă';
			case 'sent':
				return 'Trimis';
			case 'signed':
				return 'Semnat';
			case 'cancelled':
				return 'Anulat';
			default:
				return status;
		}
	}

	function handleDragOver(e: DragEvent) {
		e.preventDefault();
		e.stopPropagation();
		isDragging = true;
	}

	function handleDragLeave(e: DragEvent) {
		e.preventDefault();
		e.stopPropagation();
		isDragging = false;
	}

	function handleDrop(e: DragEvent) {
		e.preventDefault();
		e.stopPropagation();
		isDragging = false;
		const files = e.dataTransfer?.files;
		if (files && files.length > 0) {
			const f = files[0];
			if (f.type === 'application/pdf') {
				uploadFile = f;
				if (!uploadTitle) {
					uploadTitle = f.name.replace(/\.pdf$/i, '');
				}
			} else {
				uploadError = 'Doar fișiere PDF sunt acceptate';
			}
		}
	}

	function handleFileSelect(e: Event) {
		const target = e.target as HTMLInputElement;
		const files = target.files;
		if (files && files.length > 0) {
			uploadFile = files[0];
			if (!uploadTitle) {
				uploadTitle = files[0].name.replace(/\.pdf$/i, '');
			}
		}
	}

	function handleRemoveFile() {
		uploadFile = null;
		if (fileInputRef) fileInputRef.value = '';
	}

	function resetUploadModal() {
		uploadFile = null;
		uploadTitle = '';
		uploadDate = '';
		uploadNumber = '';
		uploadError = null;
		if (fileInputRef) fileInputRef.value = '';
	}

	async function handleUploadContract() {
		if (!uploadFile) {
			uploadError = 'Selectează un fișier PDF';
			return;
		}
		uploading = true;
		uploadError = null;
		try {
			const formData = new FormData();
			formData.append('file', uploadFile);
			formData.append('clientId', clientId as string);
			if (uploadTitle) formData.append('contractTitle', uploadTitle);
			if (uploadDate) formData.append('contractDate', uploadDate);
			if (uploadNumber) formData.append('contractNumber', uploadNumber);

			const res = await fetch(`/${tenantSlug}/contracts/upload`, { method: 'POST', body: formData });
			if (!res.ok) {
				const errData = await res.json().catch(() => null);
				throw new Error(errData?.message || 'Eroare la încărcarea contractului');
			}
			const result = await res.json();
			console.log('[ClientUpload] Server response:', JSON.stringify(result));
			await invalidateAll();
			showUploadModal = false;
			resetUploadModal();
			toast.success('Contractul a fost încărcat cu succes');
			try {
				console.log('[ClientUpload] Calling extractClientFromContract with contractId:', result.contractId, 'clientId:', clientId);
				const extraction = await extractClientFromContract({ contractId: result.contractId as string })
					.updates(getClient(clientId as string));
				console.log('[ClientUpload] Extraction result:', JSON.stringify(extraction));
				if (extraction.extracted && Object.keys(extraction.extracted).length > 0) {
					extractionReport = {
						extracted: extraction.extracted,
						updated: extraction.updated || {},
						skipped: extraction.skipped || {}
					};
					showExtractionReport = true;
					console.log('[ClientUpload] showExtractionReport set to true');
				} else {
					console.log('[ClientUpload] No extracted data, extraction.extracted:', extraction.extracted);
				}
			} catch (extractErr) {
				console.error('[ClientUpload] extractClientFromContract error:', extractErr);
			}
		} catch (e) {
			uploadError = e instanceof Error ? e.message : 'Eroare la încărcarea contractului';
		} finally {
			uploading = false;
		}
	}
</script>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h2 class="text-2xl font-semibold">Contracte</h2>
		<div class="flex items-center gap-2">
			<Button
				variant="outline"
				onclick={() => {
					resetUploadModal();
					showUploadModal = true;
				}}
			>
				<Upload class="mr-2 h-4 w-4" />
				Încarcă Contract
			</Button>
			<Button onclick={() => goto(`/${tenantSlug}/contracts/new`)}>
				<Plus class="mr-2 h-4 w-4" />
				Contract Nou
			</Button>
		</div>
	</div>

	{#if loading}
		<p class="text-muted-foreground">Se încarcă...</p>
	{:else if contracts.length === 0}
		<Card>
			<CardContent class="pt-6">
				<p class="text-center text-muted-foreground">Niciun contract pentru acest client</p>
			</CardContent>
		</Card>
	{:else}
		<div class="space-y-4">
			{#each contracts as contract}
				<Card>
					<CardContent class="p-6">
						<div class="flex items-start justify-between gap-4">
							<div class="flex items-start gap-4">
								<div
									class="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10"
								>
									<FileText class="h-5 w-5 text-primary" />
								</div>
								<div>
									<div class="flex items-center gap-2">
										<p class="text-lg font-semibold">{contract.contractNumber}</p>
										{#if contract.uploadedFilePath}
											<Badge variant="outline" class="text-xs">
												<Upload class="h-3 w-3 mr-1" />
												Încărcat
											</Badge>
										{/if}
									</div>
									{#if contract.contractTitle}
										<p class="text-sm text-muted-foreground">
											{contract.contractTitle}
										</p>
									{/if}
									<div class="flex items-center gap-3 mt-1">
										<Badge variant={getStatusVariant(contract.status)}>
											{getStatusLabel(contract.status)}
										</Badge>
										{#if contract.contractDate}
											<span class="text-sm text-muted-foreground">
												{new Date(contract.contractDate).toLocaleDateString(
													'ro-RO'
												)}
											</span>
										{/if}
									</div>
								</div>
							</div>
							<div class="flex items-center gap-2">
								<Button
									variant="outline"
									onclick={() =>
										window.open(
											`/${tenantSlug}/contracts/${contract.id}/pdf`,
											'_blank'
										)}
								>
									<ExternalLink class="h-4 w-4 mr-2" />
									PDF
								</Button>
								<Button
									onclick={() =>
										goto(`/${tenantSlug}/contracts/${contract.id}`)}
								>
									Detalii
								</Button>
							</div>
						</div>
					</CardContent>
				</Card>
			{/each}
		</div>
	{/if}
</div>

<Dialog bind:open={showUploadModal}>
	<DialogContent class="sm:max-w-xl border-2 shadow-2xl max-h-[85vh] overflow-y-auto">
		<DialogHeader>
			<div class="flex items-center gap-3">
				<div class="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
					<Upload class="h-5 w-5 text-primary" />
				</div>
				<div>
					<DialogTitle>Încarcă Contract</DialogTitle>
					<DialogDescription>Încarcă un contract PDF existent</DialogDescription>
				</div>
			</div>
		</DialogHeader>
		<div class="space-y-4">
			<div class="space-y-2">
				<Label class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Fișier PDF *</Label>
				{#if uploadFile}
					<div class="group relative">
						<div class="relative flex w-full items-center gap-4 rounded-lg border-2 border-primary/20 bg-primary/5 p-4 transition-colors">
							<div class="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
								<FileText class="h-5 w-5 text-primary" />
							</div>
							<div class="min-w-0 flex-1">
								<p class="truncate text-sm font-semibold">{uploadFile.name}</p>
								<p class="text-xs text-muted-foreground">
									{(uploadFile.size / 1024 / 1024).toFixed(2)} MB
								</p>
							</div>
							<Button
								type="button" variant="ghost" size="sm"
								class="opacity-0 transition-opacity group-hover:opacity-100"
								onclick={handleRemoveFile} disabled={uploading}
							>
								<X class="h-4 w-4" />
							</Button>
						</div>
					</div>
				{:else}
					<div
						class={cn(
							'relative flex h-[120px] w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 transition-colors',
							isDragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 bg-muted/50',
							!uploading && 'cursor-pointer hover:border-primary/50'
						)}
						ondragover={handleDragOver}
						ondragleave={handleDragLeave}
						ondrop={handleDrop}
						onclick={() => !uploading && fileInputRef?.click()}
						role="button"
						tabindex="0"
					>
						<input
							bind:this={fileInputRef}
							type="file" accept="application/pdf" class="hidden"
							disabled={uploading} onchange={handleFileSelect}
						/>
						<Upload class="h-8 w-8 text-muted-foreground" />
						<div class="text-center">
							<p class="text-sm font-medium">
								<span class="text-primary underline">Click pentru upload</span> sau drag & drop
							</p>
							<p class="mt-1 text-xs text-muted-foreground">Doar fișiere PDF</p>
						</div>
					</div>
				{/if}
			</div>

			<div class="space-y-2">
				<Label for="uploadTitle" class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Titlu contract</Label>
				<Input id="uploadTitle" bind:value={uploadTitle} placeholder="ex: Contract servicii IT" />
			</div>

			<div class="grid grid-cols-2 gap-4">
				<div class="space-y-2">
					<Label for="uploadNumber" class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Număr contract</Label>
					<Input id="uploadNumber" bind:value={uploadNumber} placeholder="Auto-generat" />
				</div>
				<div class="space-y-2">
					<Label for="uploadDate" class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Data contract</Label>
					<Input id="uploadDate" type="date" bind:value={uploadDate} />
				</div>
			</div>

			{#if uploadError}
				<div class="rounded-md border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/20">
					<p class="text-sm text-red-800 dark:text-red-200">{uploadError}</p>
				</div>
			{/if}
		</div>
		<DialogFooter class="gap-2 pt-2">
			<Button variant="outline" onclick={() => (showUploadModal = false)}>Anulează</Button>
			<Button onclick={handleUploadContract} disabled={uploading || !uploadFile}>
				{#if uploading}
					<Loader2 class="mr-2 h-4 w-4 animate-spin" />
					Se încarcă...
				{:else}
					<Upload class="mr-2 h-4 w-4" />
					Încarcă
				{/if}
			</Button>
		</DialogFooter>
	</DialogContent>
</Dialog>

<Dialog bind:open={showExtractionReport}>
	<DialogContent class="sm:max-w-lg max-h-[85vh] overflow-y-auto">
		<DialogHeader>
			<div class="flex items-center gap-3">
				<div class="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
					<Info class="h-5 w-5 text-primary" />
				</div>
				<div>
					<DialogTitle>Raport extragere date client</DialogTitle>
					<DialogDescription>Date extrase automat din contractul PDF</DialogDescription>
				</div>
			</div>
		</DialogHeader>
		{#if extractionReport}
			<div class="space-y-4 max-h-[60vh] overflow-y-auto">
				{#if Object.keys(extractionReport.updated).length > 0}
					<div class="space-y-2">
						<div class="flex items-center gap-2 text-sm font-semibold text-green-700 dark:text-green-400">
							<CheckCircle2 class="h-4 w-4" />
							Câmpuri actualizate
						</div>
						<div class="rounded-lg border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/20 divide-y divide-green-200 dark:divide-green-800">
							{#each Object.entries(extractionReport.updated) as [key, value]}
								<div class="px-3 py-2 flex justify-between gap-4">
									<span class="text-sm font-medium text-green-800 dark:text-green-300 shrink-0">{fieldLabels[key] || key}</span>
									<span class="text-sm text-green-700 dark:text-green-400 text-right truncate">{value}</span>
								</div>
							{/each}
						</div>
					</div>
				{/if}

				{#if Object.keys(extractionReport.skipped).length > 0}
					<div class="space-y-2">
						<div class="flex items-center justify-between">
							<div class="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
								<AlertCircle class="h-4 w-4" />
								Extrase dar neschimbate
							</div>
							<Button
								variant="outline"
								size="sm"
								onclick={handleUpdateSkippedFields}
								disabled={updatingSkipped}
							>
								{#if updatingSkipped}
									<Loader2 class="mr-2 h-3 w-3 animate-spin" />
									Se actualizează...
								{:else}
									<CheckCircle2 class="mr-2 h-3 w-3" />
									Actualizează toate
								{/if}
							</Button>
						</div>
						<div class="rounded-lg border divide-y">
							{#each Object.keys(extractionReport.skipped) as key}
								<div class="px-3 py-1.5 flex items-center justify-between gap-4">
									<span class="text-sm font-medium text-muted-foreground shrink-0">{fieldLabels[key] || key}</span>
									<Input
										class="max-w-[280px] h-7 text-sm text-right border-dashed"
										value={extractionReport.skipped[key]}
										oninput={(e) => { if (extractionReport) extractionReport.skipped[key] = e.currentTarget.value; }}
									/>
								</div>
							{/each}
						</div>
					</div>
				{/if}

				{#if Object.keys(extractionReport.extracted).length === 0}
					<p class="text-sm text-muted-foreground text-center py-4">Nu s-au putut extrage date din acest PDF.</p>
				{/if}
			</div>
		{/if}
		<DialogFooter>
			<Button onclick={() => (showExtractionReport = false)}>Închide</Button>
		</DialogFooter>
	</DialogContent>
</Dialog>
