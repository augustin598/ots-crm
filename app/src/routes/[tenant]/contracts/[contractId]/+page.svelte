<script lang="ts">
	import {
		getContract,
		getContracts,
		deleteContract,
		duplicateContract,
		sendContractForSigning,
		signContractAsPrestator,
		getActiveSigningToken,
		getContractInvoices
	} from '$lib/remotes/contracts.remote';
	import { getClient } from '$lib/remotes/clients.remote';
	import { getContractActivities } from '$lib/remotes/contract-activities.remote';
	import SignaturePad from '$lib/components/SignaturePad.svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Separator } from '$lib/components/ui/separator';
	import {
		Dialog,
		DialogContent,
		DialogHeader,
		DialogTitle,
		DialogFooter
	} from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import {
		ArrowLeft,
		Download,
		Edit,
		Copy,
		Trash2,
		Calendar,
		Building2,
		Mail,
		CreditCard,
		Clock,
		FileText,
		Eye,
		Send,
		PenLine
	} from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import {
		getContractStatusLabel,
		getContractStatusVariant,
		formatContractDate,
		formatContractPrice,
		getBillingFrequencyLabel
	} from '$lib/utils/contract-utils';

	let { data }: { data: any } = $props();

	const tenantSlug = $derived(page.params.tenant);
	const contractId = $derived(page.params.contractId || '');
	const tenant = $derived(data?.tenant);

	// Signing modal state
	let showSendModal = $state(false);
	let showSignModal = $state(false);
	let sendEmail = $state('');
	let prestatorSignName = $state('');
	let prestatorSignatureDataUrl = $state('');
	let sendingInProgress = $state(false);
	let signingInProgress = $state(false);
	let prestatorPadRef: SignaturePad;

	const contractQuery = getContract(contractId);
	const contract = $derived(contractQuery.current);
	const loading = $derived(contractQuery.loading);

	const activeTokenQuery = $derived(contractId ? getActiveSigningToken(contractId) : null);
	const activeToken = $derived(activeTokenQuery?.current);

	// Signing URL: comes from active token in DB (persists across reloads)
	const signingUrl = $derived(
		activeToken?.hasActiveToken && !contract?.beneficiarSignedAt
			? (activeToken.signingUrl ?? '')
			: ''
	);

	const clientQuery = $derived(contract?.clientId ? getClient(contract.clientId) : null);
	const client = $derived(clientQuery?.current);

	const lineItems = $derived(contract?.lineItems || []);

	// Calculate totals
	const subtotal = $derived(
		lineItems.reduce((sum: number, item: any) => sum + (item.price || 0), 0)
	);
	const discountAmount = $derived(
		contract?.discountPercent ? (subtotal * contract.discountPercent) / 100 : 0
	);
	const total = $derived(subtotal - discountAmount);

	// Linked invoices
	const contractInvoicesQuery = $derived(contractId ? getContractInvoices(contractId) : null);
	const contractInvoices = $derived(contractInvoicesQuery?.current || []);

	// Activities
	const activitiesQuery = $derived(contractId ? getContractActivities(contractId) : null);
	const activities = $derived(activitiesQuery?.current || []);
	const activitiesLoading = $derived(activitiesQuery?.loading ?? false);

	function formatTimeAgo(date: string | Date | null): string {
		if (!date) return '';
		const d = typeof date === 'string' ? new Date(date) : date;
		const now = new Date();
		const diffMs = now.getTime() - d.getTime();
		const diffMin = Math.floor(diffMs / 60000);
		if (diffMin < 1) return 'acum';
		if (diffMin < 60) return `acum ${diffMin} min`;
		const diffHours = Math.floor(diffMin / 60);
		if (diffHours < 24) return `acum ${diffHours}h`;
		const diffDays = Math.floor(diffHours / 24);
		if (diffDays < 30) return `acum ${diffDays}z`;
		return formatContractDate(date);
	}

	// Using shared utils: getContractStatusVariant, getContractStatusLabel, formatContractDate, formatContractPrice, getBillingFrequencyLabel

	async function handleSendForSigning() {
		if (!contractId || !sendEmail) return;
		sendingInProgress = true;
		try {
			const result = await sendContractForSigning({ contractId, email: sendEmail }).updates(contractQuery, activeTokenQuery!);
			showSendModal = false;
			if (result.emailSent) {
				toast.success(`Link de semnare trimis la ${sendEmail}`);
			} else {
				toast.warning('Emailul nu a putut fi trimis. Link-ul este disponibil în secțiunea Semnaturi.');
			}
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la generarea link-ului');
		} finally {
			sendingInProgress = false;
		}
	}

	function copySigningUrl() {
		if (!signingUrl) return;
		navigator.clipboard.writeText(signingUrl).then(() => toast.success('Link copiat!'));
	}

	async function handleSignAsPrestator() {
		if (!contractId || !prestatorSignName || !prestatorSignatureDataUrl) return;
		signingInProgress = true;
		try {
			await signContractAsPrestator({
				contractId,
				signatureName: prestatorSignName,
				signatureImage: prestatorSignatureDataUrl
			}).updates(contractQuery);
			showSignModal = false;
			toast.success('Contract semnat cu succes');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la semnare');
		} finally {
			signingInProgress = false;
		}
	}

	function handlePreviewPDF() {
		if (!contractId) return;
		window.open(`/${tenantSlug}/contracts/${contractId}/pdf?inline=true`, '_blank');
	}

	async function handleDownloadPDF() {
		if (!contractId) return;
		try {
			const response = await fetch(`/${tenantSlug}/contracts/${contractId}/pdf`);
			if (!response.ok) throw new Error('Failed to generate PDF');
			const blob = await response.blob();
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `Contract-${contract?.contractNumber || contractId}.pdf`;
			a.click();
			URL.revokeObjectURL(url);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la descarcarea PDF');
		}
	}

	async function handleDuplicate() {
		if (!contractId) return;
		try {
			const result = await duplicateContract(contractId);
			if (result.success && result.contractId) {
				toast.success('Contract duplicat cu succes');
				goto(`/${tenantSlug}/contracts/${result.contractId}`);
			}
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la duplicarea contractului');
		}
	}

	let showDeleteDialog = $state(false);
	let deleting = $state(false);

	async function executeDelete() {
		if (!contractId) return;
		deleting = true;
		try {
			await deleteContract(contractId).updates(contractQuery, getContracts({}));
			toast.success('Contract șters cu succes');
			goto(`/${tenantSlug}/contracts`);
		} catch (e) {
			console.error('Delete contract error:', e);
			const message = e instanceof Error ? e.message : typeof e === 'string' ? e : 'Eroare la ștergerea contractului';
			toast.error(message);
		} finally {
			deleting = false;
		}
	}
</script>

<svelte:head>
	<title>Contract {contract?.contractNumber || ''} - CRM</title>
</svelte:head>

<div class="space-y-6">
	{#if loading}
		<p>Se incarca contractul...</p>
	{:else if contract}
		<!-- Header -->
		<div class="mb-6">
			<Button
				variant="ghost"
				size="sm"
				class="mb-4"
				onclick={() => goto(`/${tenantSlug}/contracts`)}
			>
				<ArrowLeft class="mr-2 h-4 w-4" />
				Inapoi la Contracte
			</Button>

			<div class="flex items-start justify-between">
				<div>
					<div class="flex items-center gap-3 mb-2">
						<h1 class="text-3xl font-bold tracking-tight">
							Contract NR {contract.contractNumber}
						</h1>
						<Badge variant={getContractStatusVariant(contract.status)}>
							{getContractStatusLabel(contract.status)}
						</Badge>
					</div>
					<p class="text-lg text-muted-foreground">{client?.name || 'Client necunoscut'}</p>
				</div>
				<div class="flex gap-2 flex-wrap">
					<Button variant="outline" onclick={handlePreviewPDF} title="Previzualizare PDF">
						<Eye class="h-4 w-4" />
					</Button>
					<Button variant="outline" onclick={handleDownloadPDF}>
						<Download class="mr-2 h-4 w-4" />
						Download PDF
					</Button>
					{#if contract.status === 'draft' || contract.status === 'sent'}
						<Button
							variant="outline"
							onclick={() => { sendEmail = contract.beneficiarEmail || ''; showSendModal = true; }}
						>
							<Send class="mr-2 h-4 w-4" />
							Trimite la semnat
						</Button>
					{/if}
					{#if !contract.prestatorSignedAt}
						<Button
							variant="outline"
							onclick={() => { prestatorSignName = ''; prestatorSignatureDataUrl = ''; prestatorPadRef?.clear(); showSignModal = true; }}
						>
							<PenLine class="mr-2 h-4 w-4" />
							Semneaza
						</Button>
					{/if}
					{#if contract.status === 'draft' || contract.status === 'sent'}
						<Button
							variant="outline"
							onclick={() => goto(`/${tenantSlug}/contracts/${contractId}/edit`)}
						>
							<Edit class="mr-2 h-4 w-4" />
							Editeaza
						</Button>
					{/if}
					<Button variant="outline" onclick={handleDuplicate}>
						<Copy class="mr-2 h-4 w-4" />
						Duplica
					</Button>
				</div>
			</div>
		</div>

		<!-- Content: 2 columns -->
		<div class="grid gap-6 lg:grid-cols-3">
			<!-- Left column (main) -->
			<div class="lg:col-span-2 space-y-6">
				<!-- Contract summary card -->
				<Card class="p-8">
					<div class="flex justify-between items-start mb-8">
						<div>
							<h2 class="text-2xl font-bold mb-2">
								{tenant?.name || 'Compania ta'}
							</h2>
							{#if tenant?.address}
								<p class="text-muted-foreground">{tenant.address}</p>
							{/if}
							{#if tenant?.city}
								<p class="text-muted-foreground">
									{tenant.city}
									{#if tenant.county}, {tenant.county}{/if}
								</p>
							{/if}
							{#if tenant?.email}
								<p class="text-muted-foreground">{tenant.email}</p>
							{/if}
						</div>
						<div class="text-right">
							<h3 class="text-3xl font-bold mb-2">CONTRACT</h3>
							<p class="text-muted-foreground">{contract.contractNumber}</p>
						</div>
					</div>

					<Separator class="my-6" />

					<div class="grid md:grid-cols-2 gap-8 mb-8">
						<div>
							<h4 class="font-semibold mb-2">Beneficiar:</h4>
							<p class="font-medium">{client?.name || 'Client necunoscut'}</p>
							{#if client?.cui}
								<p class="text-muted-foreground">CUI: {client.cui}</p>
							{/if}
							{#if client?.registrationNumber}
								<p class="text-muted-foreground">Reg: {client.registrationNumber}</p>
							{/if}
							{#if client?.email}
								<p class="text-muted-foreground">{client.email}</p>
							{/if}
							{#if client?.address}
								<p class="text-muted-foreground">{client.address}</p>
							{/if}
						</div>
						<div>
							<div class="space-y-2">
								<div class="flex justify-between">
									<span class="text-muted-foreground">Titlu:</span>
									<span class="font-medium">{contract.contractTitle || '-'}</span>
								</div>
								<div class="flex justify-between">
									<span class="text-muted-foreground">Data contract:</span>
									<span class="font-medium">{formatContractDate(contract.contractDate)}</span>
								</div>
								<div class="flex justify-between">
									<span class="text-muted-foreground">Moneda:</span>
									<span class="font-medium">{contract.currency || 'EUR'}</span>
								</div>
								<div class="flex justify-between">
									<span class="text-muted-foreground">Frecventa facturare:</span>
									<span class="font-medium">
										{getBillingFrequencyLabel(contract.billingFrequency)}
									</span>
								</div>
								<div class="flex justify-between">
									<span class="text-muted-foreground">Durata minima:</span>
									<span class="font-medium">{contract.contractDurationMonths || '-'} luni</span>
								</div>
							</div>
						</div>
					</div>

					{#if contract.serviceDescription}
						<div class="mb-8">
							<h4 class="font-semibold mb-2">Obiectul contractului:</h4>
							<p class="text-sm text-muted-foreground whitespace-pre-wrap">
								{contract.serviceDescription}
							</p>
						</div>
					{/if}

					<!-- Service table -->
					<div class="mb-8">
						<table class="w-full">
							<thead>
								<tr class="border-b">
									<th class="text-left py-3 font-semibold">Descriere</th>
									<th class="text-right py-3 font-semibold">Pret</th>
									<th class="text-left py-3 font-semibold">UM</th>
								</tr>
							</thead>
							<tbody>
								{#each lineItems as item}
									<tr class="border-b">
										<td class="py-4">
											<p class="font-medium">{item.description}</p>
										</td>
										<td class="text-right py-4 font-medium">
											{formatContractPrice(item.price)} {contract.currency || 'EUR'}
										</td>
										<td class="py-4">{item.unitOfMeasure || 'Luna'}</td>
									</tr>
								{:else}
									<tr>
										<td colspan="3" class="py-8 text-center text-muted-foreground">
											Nu exista servicii
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>

					<!-- Totals -->
					<div class="flex justify-end">
						<div class="w-64 space-y-2">
							<div class="flex justify-between">
								<span class="text-muted-foreground">Subtotal:</span>
								<span class="font-medium">
									{formatContractPrice(subtotal)} {contract.currency || 'EUR'}
								</span>
							</div>
							{#if contract.discountPercent && contract.discountPercent > 0}
								<div class="flex justify-between">
									<span class="text-muted-foreground">
										Discount ({contract.discountPercent}%):
									</span>
									<span class="font-medium">
										-{formatContractPrice(discountAmount)} {contract.currency || 'EUR'}
									</span>
								</div>
							{/if}
							<Separator />
							<div class="flex justify-between text-lg">
								<span class="font-semibold">Total:</span>
								<span class="font-bold">
									{formatContractPrice(total)} {contract.currency || 'EUR'}
								</span>
							</div>
						</div>
					</div>
				</Card>

				{#if contract.notes}
					<Card class="p-6">
						<CardHeader>
							<CardTitle>Note</CardTitle>
						</CardHeader>
						<CardContent>
							<p class="text-sm text-muted-foreground whitespace-pre-wrap">
								{contract.notes}
							</p>
						</CardContent>
					</Card>
				{/if}

				<!-- Linked invoices -->
				{#if contractInvoices.length > 0}
					<Card class="p-6">
						<CardHeader>
							<CardTitle>Facturi Asociate</CardTitle>
						</CardHeader>
						<CardContent>
							<div class="overflow-x-auto">
								<table class="w-full text-sm">
									<thead>
										<tr class="border-b">
											<th class="text-left py-2 font-medium">Număr</th>
											<th class="text-left py-2 font-medium">Data</th>
											<th class="text-right py-2 font-medium">Total</th>
											<th class="text-left py-2 font-medium">Status</th>
										</tr>
									</thead>
									<tbody>
										{#each contractInvoices as inv}
											<tr class="border-b hover:bg-muted/50 cursor-pointer" onclick={() => goto(`/${tenantSlug}/invoices/${inv.id}`)}>
												<td class="py-2">{inv.invoiceNumber}</td>
												<td class="py-2">{formatContractDate(inv.issueDate)}</td>
												<td class="py-2 text-right">{inv.totalAmount ? formatContractPrice(inv.totalAmount) : '-'} {inv.currency || 'RON'}</td>
												<td class="py-2"><Badge variant="outline">{inv.status}</Badge></td>
											</tr>
										{/each}
									</tbody>
								</table>
							</div>
						</CardContent>
					</Card>
				{/if}

				<!-- Activity timeline -->
				<Card class="p-6">
					<CardHeader>
						<CardTitle>Istoric Modificări</CardTitle>
					</CardHeader>
					<CardContent>
						{#if activitiesLoading}
							<p class="text-sm text-muted-foreground">Se încarcă...</p>
						{:else if activities.length === 0}
							<p class="text-sm text-muted-foreground">Nicio activitate înregistrată.</p>
						{:else}
							<div class="space-y-4">
								{#each activities as activity}
									<div class="flex gap-3">
										<div class="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
											<span class="text-xs font-medium text-primary">
												{activity.userName.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
											</span>
										</div>
										<div class="flex-1 min-w-0">
											<p class="text-sm">
												<span class="font-medium">{activity.userName}</span>
												{' '}
												{#if activity.action === 'created'}
													a creat contractul
												{:else if activity.action === 'updated' && activity.field}
													a modificat <span class="font-mono text-xs bg-muted px-1 rounded">{activity.field}</span>
												{:else if activity.action === 'status_changed'}
													a schimbat statusul{#if activity.oldValue} de la <Badge variant="outline" class="text-xs">{getContractStatusLabel(activity.oldValue)}</Badge>{/if} la <Badge variant="outline" class="text-xs">{getContractStatusLabel(activity.newValue || '')}</Badge>
												{:else if activity.action === 'sent_for_signing'}
													a trimis contractul pentru semnare{#if activity.newValue} la <span class="font-medium">{activity.newValue}</span>{/if}
												{:else if activity.action === 'signed_prestator'}
													a semnat ca prestator
												{:else if activity.action === 'duplicated'}
													a duplicat contractul
												{:else}
													{activity.action}
												{/if}
											</p>
											<p class="text-xs text-muted-foreground">{formatTimeAgo(activity.createdAt)}</p>
										</div>
									</div>
								{/each}
							</div>
						{/if}
					</CardContent>
				</Card>
			</div>

			<!-- Right column (sidebar) -->
			<div class="space-y-6">
				<!-- Status card -->
				<Card class="p-6">
					<CardHeader>
						<CardTitle>Sumar Contract</CardTitle>
					</CardHeader>
					<CardContent class="space-y-4">
						<div>
							<p class="text-sm text-muted-foreground mb-1">Status</p>
							<Badge variant={getContractStatusVariant(contract.status)}>
								{getContractStatusLabel(contract.status)}
							</Badge>
						</div>
						<Separator />
						<div>
							<p class="text-sm text-muted-foreground mb-1">Valoare totala</p>
							<p class="text-2xl font-bold">
								{formatContractPrice(total)} {contract.currency || 'EUR'}
							</p>
						</div>
						<Separator />
						<div class="flex items-center gap-2">
							<Calendar class="h-4 w-4 text-muted-foreground" />
							<div>
								<p class="text-sm text-muted-foreground">Data contract</p>
								<p class="font-medium">{formatContractDate(contract.contractDate)}</p>
							</div>
						</div>
						<div class="flex items-center gap-2">
							<Clock class="h-4 w-4 text-muted-foreground" />
							<div>
								<p class="text-sm text-muted-foreground">Durata minima</p>
								<p class="font-medium">{contract.contractDurationMonths || '-'} luni</p>
							</div>
						</div>
						<Separator />
						<div>
							<p class="text-sm text-muted-foreground mb-2">Semnaturi</p>
							<div class="space-y-1 text-sm">
								<div class="flex items-center gap-2">
									{#if contract.prestatorSignedAt}
										<span class="text-green-600 font-medium">✓</span>
										<span>Prestator: <span class="font-medium">{contract.prestatorSignatureName}</span></span>
									{:else}
										<span class="text-gray-400">✗</span>
										<span class="text-muted-foreground">Prestator: nesemnat</span>
									{/if}
								</div>
								<div class="flex items-center gap-2">
									{#if contract.beneficiarSignedAt}
										<span class="text-green-600 font-medium">✓</span>
										<span>Beneficiar: <span class="font-medium">{contract.beneficiarSignatureName}</span></span>
									{:else}
										<span class="text-gray-400">✗</span>
										<span class="text-muted-foreground">Beneficiar: nesemnat</span>
									{/if}
								</div>
							</div>
							{#if signingUrl}
								<div class="mt-3 p-2 bg-amber-50 border border-amber-200 rounded space-y-1">
									<p class="text-xs text-amber-800 font-medium">Link semnare:</p>
									<div class="flex gap-1 items-center">
										<input
											type="text"
											readonly
											value={signingUrl}
											class="flex-1 text-xs border rounded px-2 py-1 bg-white font-mono truncate"
											onclick={(e) => (e.target as HTMLInputElement).select()}
										/>
										<Button size="sm" variant="outline" class="shrink-0 h-7 px-2 text-xs" onclick={copySigningUrl}>Copiaza</Button>
									</div>
								</div>
							{/if}
						</div>
					</CardContent>
				</Card>

				<!-- Client info card -->
				{#if client}
					<Card class="p-6">
						<CardHeader>
							<CardTitle>Informatii Client</CardTitle>
						</CardHeader>
						<CardContent class="space-y-3">
							{#if client.name}
								<div class="flex items-center gap-3">
									<Building2 class="h-5 w-5 text-muted-foreground" />
									<div>
										<p class="text-sm text-muted-foreground">Companie</p>
										<p class="font-medium">{client.name}</p>
									</div>
								</div>
							{/if}
							{#if client.cui}
								<div class="flex items-center gap-3">
									<Building2 class="h-5 w-5 text-muted-foreground" />
									<div>
										<p class="text-sm text-muted-foreground">CUI</p>
										<p class="font-medium">{client.cui}</p>
									</div>
								</div>
							{/if}
							{#if client.email}
								<div class="flex items-center gap-3">
									<Mail class="h-5 w-5 text-muted-foreground" />
									<div>
										<p class="text-sm text-muted-foreground">Email</p>
										<p class="font-medium">{client.email}</p>
									</div>
								</div>
							{/if}
						</CardContent>
						<CardContent>
							<Button
								variant="outline"
								class="w-full bg-transparent"
								onclick={() => goto(`/${tenantSlug}/clients/${client.id}`)}
							>
								Vezi profil client
							</Button>
						</CardContent>
					</Card>
				{/if}

				<!-- Payment terms card -->
				<Card class="p-6">
					<CardHeader>
						<CardTitle>Termeni Plata</CardTitle>
					</CardHeader>
					<CardContent class="space-y-3">
						<div class="flex items-center gap-3">
							<CreditCard class="h-5 w-5 text-muted-foreground" />
							<div>
								<p class="text-sm text-muted-foreground">Zile plata</p>
								<p class="font-medium">{contract.paymentTermsDays ?? 5} zile</p>
							</div>
						</div>
						<div class="flex items-center gap-3">
							<FileText class="h-5 w-5 text-muted-foreground" />
							<div>
								<p class="text-sm text-muted-foreground">Rata penalizare</p>
								<p class="font-medium">
									{contract.penaltyRate ? (contract.penaltyRate / 100).toFixed(2) : '0.50'}%
								</p>
							</div>
						</div>
						<div class="flex items-center gap-3">
							<Clock class="h-5 w-5 text-muted-foreground" />
							<div>
								<p class="text-sm text-muted-foreground">Frecventa facturare</p>
								<p class="font-medium">
									{getBillingFrequencyLabel(contract.billingFrequency)}
								</p>
							</div>
						</div>
						{#if contract.hourlyRate}
							<div class="flex items-center gap-3">
								<CreditCard class="h-5 w-5 text-muted-foreground" />
								<div>
									<p class="text-sm text-muted-foreground">Tarif orar suplimentar</p>
									<p class="font-medium">
										{(contract.hourlyRate / 100).toFixed(2)} {contract.hourlyRateCurrency || 'EUR'}
									</p>
								</div>
							</div>
						{/if}
					</CardContent>
				</Card>

				<!-- Quick actions card -->
				<Card class="p-6">
					<CardHeader>
						<CardTitle>Actiuni rapide</CardTitle>
					</CardHeader>
					<CardContent class="space-y-2">
						<Button variant="outline" class="w-full bg-transparent" onclick={handlePreviewPDF}>
							<Eye class="mr-2 h-4 w-4" />
							Previzualizare PDF
						</Button>
						<Button class="w-full" onclick={handleDownloadPDF}>
							<Download class="mr-2 h-4 w-4" />
							Download PDF
						</Button>
						{#if contract.status === 'draft' || contract.status === 'sent'}
							<Button
								variant="outline"
								class="w-full bg-transparent"
								onclick={() => goto(`/${tenantSlug}/contracts/${contractId}/edit`)}
							>
								<Edit class="mr-2 h-4 w-4" />
								Editeaza
							</Button>
						{/if}
						<Button variant="outline" class="w-full bg-transparent" onclick={handleDuplicate}>
							<Copy class="mr-2 h-4 w-4" />
							Duplica contract
						</Button>
						<Button
							variant="destructive"
							class="w-full"
							onclick={() => (showDeleteDialog = true)}
						>
							<Trash2 class="mr-2 h-4 w-4" />
							Sterge contract
						</Button>
					</CardContent>
				</Card>
			</div>
		</div>
	{:else}
		<p>Contractul nu a fost gasit</p>
	{/if}
</div>

<!-- Send for signing modal -->
<Dialog bind:open={showSendModal}>
	<DialogContent>
		<DialogHeader>
			<DialogTitle>Trimite contract la semnat</DialogTitle>
		</DialogHeader>
		<div class="space-y-4 py-2">
			<p class="text-sm text-muted-foreground">
				Va fi trimis un email cu un link de semnare la adresa de mai jos.
			</p>
			<div>
				<label for="sendEmailInput" class="block text-sm font-medium mb-1">Email beneficiar</label>
				<Input
					id="sendEmailInput"
					type="email"
					bind:value={sendEmail}
					placeholder="client@example.com"
				/>
			</div>
		</div>
		<DialogFooter>
			<Button variant="outline" onclick={() => (showSendModal = false)}>Anuleaza</Button>
			<Button
				onclick={handleSendForSigning}
				disabled={sendingInProgress || !sendEmail}
			>
				{sendingInProgress ? 'Se trimite...' : 'Trimite link'}
			</Button>
		</DialogFooter>
	</DialogContent>
</Dialog>

<!-- Prestator sign modal -->
<Dialog bind:open={showSignModal}>
	<DialogContent class="sm:max-w-lg max-h-[85vh] overflow-y-auto">
		<DialogHeader>
			<DialogTitle>Semnează ca Prestator</DialogTitle>
		</DialogHeader>
		<div class="space-y-4 py-2">
			<div>
				<label class="block text-sm font-medium mb-2">Semnătură <span class="text-red-500">*</span></label>
				<SignaturePad
					bind:this={prestatorPadRef}
					onchange={(url) => { prestatorSignatureDataUrl = url; }}
				/>
				<p class="text-xs text-muted-foreground mt-1">Desenați semnătura cu mouse-ul sau degetul</p>
			</div>
			<div>
				<label for="prestatorSignInput" class="block text-sm font-medium mb-1">Nume complet <span class="text-red-500">*</span></label>
				<Input
					id="prestatorSignInput"
					type="text"
					bind:value={prestatorSignName}
					placeholder="ex: Ion Popescu"
					maxlength={100}
				/>
			</div>
		</div>
		<DialogFooter>
			<Button variant="outline" onclick={() => (showSignModal = false)}>Anuleaza</Button>
			<Button
				onclick={handleSignAsPrestator}
				disabled={signingInProgress || !prestatorSignName.trim() || !prestatorSignatureDataUrl}
			>
				{signingInProgress ? 'Se semnează...' : 'Semnez'}
			</Button>
		</DialogFooter>
	</DialogContent>
</Dialog>

<!-- Delete confirmation dialog -->
<Dialog bind:open={showDeleteDialog}>
	<DialogContent class="sm:max-w-md">
		<DialogHeader>
			<DialogTitle>Confirmare ștergere</DialogTitle>
		</DialogHeader>
		<p class="text-sm text-muted-foreground py-2">Ești sigur că vrei să ștergi acest contract? Acțiunea este ireversibilă.</p>
		<DialogFooter class="gap-2">
			<Button variant="outline" onclick={() => (showDeleteDialog = false)} disabled={deleting}>Anulează</Button>
			<Button variant="destructive" onclick={executeDelete} disabled={deleting}>
				{deleting ? 'Se șterge...' : 'Șterge contractul'}
			</Button>
		</DialogFooter>
	</DialogContent>
</Dialog>
