<script lang="ts">
	import { getContracts, deleteContract, duplicateContract, extractClientFromContract } from '$lib/remotes/contracts.remote';
	import { getClients, getClient, updateClient } from '$lib/remotes/clients.remote';
	import { page } from '$app/state';
	import { goto, invalidateAll } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import { clientLogger } from '$lib/client-logger';
	// formatAmount removed — using shared contract-utils
	import { Card } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import {
		DropdownMenu,
		DropdownMenuContent,
		DropdownMenuItem,
		DropdownMenuTrigger
	} from '$lib/components/ui/dropdown-menu';
	import {
		Dialog,
		DialogContent,
		DialogHeader,
		DialogTitle,
		DialogFooter,
		DialogDescription
	} from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import Combobox from '$lib/components/ui/combobox/combobox.svelte';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import MoreVerticalIcon from '@lucide/svelte/icons/more-vertical';
	import FileSignatureIcon from '@lucide/svelte/icons/file-signature';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import { Upload, X, Loader2, FileText, CheckCircle2, AlertCircle, Info } from '@lucide/svelte';
	import { cn } from '$lib/utils';
	import {
		getContractStatusLabel,
		getContractStatusVariant,
		getContractStatusClass,
		formatContractDate
	} from '$lib/utils/contract-utils';

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

	// Search state
	let searchValue = $state('');
	let searchTimeout: ReturnType<typeof setTimeout> | undefined;
	let activeSearch = $state('');

	function handleSearchInput(e: Event) {
		const value = (e.target as HTMLInputElement).value;
		searchValue = value;
		clearTimeout(searchTimeout);
		searchTimeout = setTimeout(() => {
			activeSearch = value;
		}, 300);
	}

	// Pagination state
	let currentPage = $state(1);
	let pageSize = $state(25);

	// Reset page when search changes
	$effect(() => {
		activeSearch;
		currentPage = 1;
	});

	// Queries
	const contractsQuery = $derived(getContracts({ search: activeSearch || undefined, page: currentPage, pageSize }));
	const contractsResult = $derived(contractsQuery.current);
	const contracts = $derived(contractsResult?.contracts || []);
	const totalCount = $derived(contractsResult?.totalCount || 0);
	const totalPages = $derived(contractsResult?.totalPages || 0);
	const contractsLoading = $derived(contractsQuery.loading);
	const contractsError = $derived(contractsQuery.error);

	const clientsQuery = getClients();
	const clients = $derived(clientsQuery.current || []);
	const clientMap = $derived(new Map(clients.map((client) => [client.id, client.name])));

	// Using shared utils: getContractStatusVariant, getContractStatusClass, getContractStatusLabel, formatContractDate

	// Delete confirmation dialog
	let showDeleteDialog = $state(false);
	let deleteTargetId = $state('');
	let deleting = $state(false);

	function confirmDeleteContract(contractId: string) {
		deleteTargetId = contractId;
		showDeleteDialog = true;
	}

	async function executeDeleteContract() {
		if (!deleteTargetId) return;
		deleting = true;
		try {
			await deleteContract(deleteTargetId).updates(contractsQuery);
			toast.success('Contractul a fost șters.');
			showDeleteDialog = false;
			deleteTargetId = '';
		} catch (e) {
			console.error('Delete contract error:', e);
			clientLogger.apiError('contract_delete', e);
		} finally {
			deleting = false;
		}
	}

	async function handleDuplicateContract(contractId: string) {
		try {
			const result = await duplicateContract(contractId).updates(contractsQuery);
			toast.success('Contractul a fost duplicat.');
			if (result?.contractId) {
				goto(`/${tenantSlug}/contracts/${result.contractId}/edit`);
			}
		} catch (e) {
			clientLogger.apiError('contract_duplicate', e);
		}
	}

	// Extraction report state
	let showExtractionReport = $state(false);
	let extractionReport = $state<{ extracted: Record<string, string>; updated: Record<string, string>; skipped: Record<string, string> } | null>(null);
	let updatingSkipped = $state(false);
	let extractionClientId = $state('');

	async function handleUpdateSkippedFields() {
		if (!extractionReport || Object.keys(extractionReport.skipped).length === 0 || !extractionClientId) return;
		updatingSkipped = true;
		try {
			// Use already-loaded clients array (getClient query may not have data on this page)
			const client = clients.find(c => c.id === extractionClientId);
			if (!client) throw new Error('Client not found');
			console.log('[Upload] Updating skipped fields for client:', client.name, extractionReport.skipped);
			await updateClient({ clientId: extractionClientId, name: client.name, ...extractionReport.skipped })
				.updates(getClient(extractionClientId), getClients());
			extractionReport = {
				extracted: extractionReport.extracted,
				updated: { ...extractionReport.updated, ...extractionReport.skipped },
				skipped: {}
			};
			toast.success('Datele clientului au fost actualizate');
		} catch (e) {
			console.error('[Upload] Update skipped fields error:', e);
			clientLogger.apiError('contract_update_skipped', e);
		} finally {
			updatingSkipped = false;
		}
	}

	// Upload modal state
	const clientOptions = $derived(clients.map((c) => ({ value: c.id, label: c.name })));
	let showUploadModal = $state(false);
	let uploadFile = $state<File | null>(null);
	let uploadClientId = $state('');
	let uploadTitle = $state('');
	let uploadDate = $state('');
	let uploadNumber = $state('');
	let uploading = $state(false);
	let uploadError = $state<string | null>(null);
	let isDragging = $state(false);
	let fileInputRef: HTMLInputElement | null = $state(null);

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
				if (!uploadTitle) uploadTitle = f.name.replace(/\.pdf$/i, '');
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
			if (!uploadTitle) uploadTitle = files[0].name.replace(/\.pdf$/i, '');
		}
	}

	function handleRemoveFile() {
		uploadFile = null;
		if (fileInputRef) fileInputRef.value = '';
	}

	function resetUploadModal() {
		uploadFile = null;
		uploadClientId = '';
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
		if (!uploadClientId) {
			uploadError = 'Selectează un client';
			return;
		}
		uploading = true;
		uploadError = null;
		try {
			const formData = new FormData();
			formData.append('file', uploadFile);
			formData.append('clientId', uploadClientId);
			if (uploadTitle) formData.append('contractTitle', uploadTitle);
			if (uploadDate) formData.append('contractDate', uploadDate);
			if (uploadNumber) formData.append('contractNumber', uploadNumber);

			const res = await fetch(`/${tenantSlug}/contracts/upload`, { method: 'POST', body: formData });
			if (!res.ok) {
				const errData = await res.json().catch(() => null);
				throw new Error(errData?.message || 'Eroare la încărcarea contractului');
			}
			const result = await res.json();
			console.log('[Upload] Server response:', JSON.stringify(result));
			const selectedClientId = uploadClientId;
			extractionClientId = selectedClientId;
			console.log('[Upload] selectedClientId:', selectedClientId);
			await invalidateAll();
			showUploadModal = false;
			resetUploadModal();
			toast.success('Contractul a fost încărcat cu succes');
			try {
				console.log('[Upload] Calling extractClientFromContract with contractId:', result.contractId);
				const extraction = await extractClientFromContract({ contractId: result.contractId })
					.updates(getClient(selectedClientId));
				console.log('[Upload] Extraction result:', JSON.stringify(extraction));
				if (extraction.extracted && Object.keys(extraction.extracted).length > 0) {
					extractionReport = {
						extracted: extraction.extracted,
						updated: extraction.updated || {},
						skipped: extraction.skipped || {}
					};
					showExtractionReport = true;
					console.log('[Upload] showExtractionReport set to true');
				} else {
					console.log('[Upload] No extracted data, extraction.extracted:', extraction.extracted);
				}
			} catch (extractErr) {
				console.error('[Upload] extractClientFromContract error:', extractErr);
				clientLogger.warn({ message: 'Nu s-au putut extrage date din PDF. Poți completa manual datele clientului.', action: 'contract_extract_client' });
			}
		} catch (e) {
			uploadError = e instanceof Error ? e.message : 'Eroare la încărcarea contractului';
		} finally {
			uploading = false;
		}
	}
</script>

<svelte:head>
	<title>Contracte - CRM</title>
</svelte:head>

<div class="space-y-6">
	<!-- Header -->
	<div class="mb-8 flex items-center justify-between">
		<div>
			<h1 class="text-3xl font-bold tracking-tight">Contracte</h1>
			<p class="text-muted-foreground mt-1">Gestioneaza contractele cu clientii</p>
		</div>
		<div class="flex items-center gap-2">
			<Button variant="outline" onclick={() => { resetUploadModal(); showUploadModal = true; }}>
				<Upload class="mr-2 h-4 w-4" />
				Încarcă Contract
			</Button>
			<Button onclick={() => goto(`/${tenantSlug}/contracts/new`)}>
				<PlusIcon class="mr-2 h-4 w-4" />
				Contract Nou
			</Button>
		</div>
	</div>

	<!-- Search bar -->
	<div class="max-w-md">
		<Input
			type="text"
			placeholder="Cauta dupa numarul contractului..."
			value={searchValue}
			oninput={handleSearchInput}
		/>
	</div>

	<!-- Contract list -->
	{#if contractsLoading}
		<div class="flex items-center justify-center p-8">
			<p class="text-muted-foreground">Se incarca contractele...</p>
		</div>
	{:else if contractsError}
		<div class="rounded-md bg-red-50 dark:bg-red-900/20 p-3">
			<p class="text-sm text-red-800 dark:text-red-200">
				{contractsError instanceof Error ? contractsError.message : 'Eroare la incarcarea contractelor'}
			</p>
		</div>
	{:else if contracts.length === 0}
		<Card>
			<div class="p-6 text-center">
				<p class="text-muted-foreground">
					{activeSearch ? 'Nu au fost gasite contracte. Incearca alt termen de cautare.' : 'Nu exista contracte. Creeaza primul contract.'}
				</p>
			</div>
		</Card>
	{:else}
		<div class="space-y-4">
			{#each contracts as contract (contract.id)}
				<Card class="group relative overflow-hidden border-2 transition-all duration-300 hover:shadow-lg hover:shadow-primary/5 hover:border-primary/20 hover:-translate-y-0.5">
					<!-- Gradient accent bar -->
					<div class="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-primary via-primary/80 to-primary/60"></div>

					<div class="p-4 pt-5">
						<div class="flex items-start justify-between gap-4">
							<div class="flex-1 min-w-0">
								<!-- Header with contract number and status -->
								<div class="flex items-center gap-2 mb-2 flex-wrap">
									<div class="flex items-center gap-1.5">
										<div class="p-1.5 rounded-lg bg-primary/10 group-hover:bg-primary/20 transition-colors">
											<FileSignatureIcon class="h-3.5 w-3.5 text-primary" />
										</div>
										<h3 class="text-lg font-bold tracking-tight text-foreground">
											{contract.contractNumber}
										</h3>
									</div>
									{#if contract.status === 'active'}
										<Badge
											variant="default"
											class="text-xs font-semibold px-2 py-0.5 shadow-sm {getContractStatusClass(contract.status)}"
										>
											{getContractStatusLabel(contract.status)}
										</Badge>
									{:else}
										<Badge
											variant={getContractStatusVariant(contract.status)}
											class="text-xs font-semibold px-2 py-0.5 shadow-sm"
										>
											{getContractStatusLabel(contract.status)}
										</Badge>
									{/if}
								</div>

								<!-- Client name -->
								<p class="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
									<span class="w-1 h-1 rounded-full bg-muted-foreground/40"></span>
									{clientMap.get(contract.clientId) || 'Client necunoscut'}
								</p>

								<!-- Contract title -->
								<p class="text-sm text-foreground mb-4 font-medium">
									{contract.contractTitle}
								</p>

								<!-- Info grid -->
								<div class="grid gap-3 md:grid-cols-3">
									<!-- Contract date -->
									<div class="p-3 rounded-lg bg-muted/30 border border-border/50 group-hover:bg-muted/50 transition-all">
										<div class="flex items-center gap-1.5 mb-1.5">
											<CalendarIcon class="h-3.5 w-3.5 text-muted-foreground/60" />
											<p class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Data Contract</p>
										</div>
										<p class="text-sm font-semibold text-foreground">
											{formatContractDate(contract.contractDate)}
										</p>
									</div>

									<!-- Duration -->
									<div class="p-3 rounded-lg bg-muted/30 border border-border/50 group-hover:bg-muted/50 transition-all">
										<div class="flex items-center gap-1.5 mb-1.5">
											<CalendarIcon class="h-3.5 w-3.5 text-muted-foreground/60" />
											<p class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Durata</p>
										</div>
										<p class="text-sm font-semibold text-foreground">
											{contract.contractDurationMonths} luni
										</p>
									</div>

									<!-- Currency -->
									<div class="p-3 rounded-lg bg-muted/30 border border-border/50 group-hover:bg-muted/50 transition-all">
										<div class="flex items-center gap-1.5 mb-1.5">
											<FileSignatureIcon class="h-3.5 w-3.5 text-muted-foreground/60" />
											<p class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Moneda</p>
										</div>
										<p class="text-sm font-semibold text-foreground">
											{contract.currency || 'EUR'}
										</p>
									</div>
								</div>
							</div>

							<!-- Action buttons -->
							<div class="flex items-center gap-1.5 flex-shrink-0">
								<Button
									variant="outline"
									size="icon"
									class="h-8 w-8 border-2 hover:border-primary/50 hover:bg-primary/5 transition-all"
									onclick={(e: MouseEvent) => { e.stopPropagation(); e.preventDefault(); window.open(`/${tenantSlug}/contracts/${contract.id}/pdf`, '_blank'); }}
									title="Vizualizeaza PDF"
								>
									<EyeIcon class="h-3.5 w-3.5" />
								</Button>
								<Button
									variant="outline"
									size="icon"
									class="h-8 w-8 border-2 hover:border-primary/50 hover:bg-primary/5 transition-all"
									onclick={async (e: MouseEvent) => { e.stopPropagation(); e.preventDefault(); const res = await fetch(`/${tenantSlug}/contracts/${contract.id}/pdf?download=true`); if (!res.ok) return; const blob = await res.blob(); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `Contract-${contract.contractNumber.replace(/[^a-zA-Z0-9-_]/g, '_')}.pdf`; a.click(); URL.revokeObjectURL(url); }}
									title="Descarca PDF"
								>
									<DownloadIcon class="h-3.5 w-3.5" />
								</Button>
								<DropdownMenu>
									<DropdownMenuTrigger>
										{#snippet child({ props })}
											<Button
												{...props}
												variant="ghost"
												size="icon"
												class="h-8 w-8 hover:bg-muted transition-all"
											>
												<MoreVerticalIcon class="h-3.5 w-3.5" />
											</Button>
										{/snippet}
									</DropdownMenuTrigger>
									<DropdownMenuContent align="end">
										<DropdownMenuItem onclick={() => goto(`/${tenantSlug}/contracts/${contract.id}`)}>
											Detalii
										</DropdownMenuItem>
										<DropdownMenuItem onclick={() => goto(`/${tenantSlug}/contracts/${contract.id}/edit`)}>
											Editeaza
										</DropdownMenuItem>
										<DropdownMenuItem onclick={() => handleDuplicateContract(contract.id)}>
											<CopyIcon class="mr-2 h-4 w-4" />
											Duplica
										</DropdownMenuItem>
										<DropdownMenuItem class="text-destructive" onclick={() => confirmDeleteContract(contract.id)}>
											Sterge
										</DropdownMenuItem>
									</DropdownMenuContent>
								</DropdownMenu>
							</div>
						</div>
					</div>
				</Card>
			{/each}
		</div>

		<!-- Pagination controls -->
		{#if totalPages > 1}
			<div class="flex items-center justify-between mt-4">
				<p class="text-sm text-muted-foreground">
					Arată {(currentPage - 1) * pageSize + 1}-{Math.min(currentPage * pageSize, totalCount)} din {totalCount} contracte
				</p>
				<div class="flex items-center gap-2">
					<select
						class="h-8 rounded-md border border-input bg-background px-2 text-sm"
						value={pageSize}
						onchange={(e) => { pageSize = Number(e.currentTarget.value); currentPage = 1; }}
					>
						<option value={10}>10</option>
						<option value={25}>25</option>
						<option value={50}>50</option>
					</select>
					<Button
						variant="outline"
						size="sm"
						disabled={currentPage <= 1}
						onclick={() => currentPage--}
					>
						Anterior
					</Button>
					<span class="text-sm text-muted-foreground">
						Pagina {currentPage} din {totalPages}
					</span>
					<Button
						variant="outline"
						size="sm"
						disabled={currentPage >= totalPages}
						onclick={() => currentPage++}
					>
						Următor
					</Button>
				</div>
			</div>
		{/if}
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
						role="button"
						tabindex="0"
						ondragover={handleDragOver}
						ondragleave={handleDragLeave}
						ondrop={handleDrop}
						onclick={() => !uploading && fileInputRef?.click()}
						onkeydown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !uploading) { e.preventDefault(); fileInputRef?.click(); } }}
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
				<Label class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Client *</Label>
				<Combobox
					bind:value={uploadClientId}
					options={clientOptions}
					placeholder="Selectează client"
					searchPlaceholder="Caută client..."
				/>
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
			<Button onclick={handleUploadContract} disabled={uploading || !uploadFile || !uploadClientId}>
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

<Dialog bind:open={showDeleteDialog}>
	<DialogContent class="sm:max-w-md">
		<DialogHeader>
			<DialogTitle>Confirmare ștergere</DialogTitle>
			<DialogDescription>Ești sigur că vrei să ștergi acest contract? Acțiunea este ireversibilă.</DialogDescription>
		</DialogHeader>
		<DialogFooter class="gap-2">
			<Button variant="outline" onclick={() => (showDeleteDialog = false)} disabled={deleting}>Anulează</Button>
			<Button variant="destructive" onclick={executeDeleteContract} disabled={deleting}>
				{#if deleting}
					Se șterge...
				{:else}
					Șterge contractul
				{/if}
			</Button>
		</DialogFooter>
	</DialogContent>
</Dialog>
