<script lang="ts">
	import { getContracts, deleteContract, duplicateContract } from '$lib/remotes/contracts.remote';
	import { getClients } from '$lib/remotes/clients.remote';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import { formatAmount, type Currency } from '$lib/utils/currency';
	import { Card } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import {
		DropdownMenu,
		DropdownMenuContent,
		DropdownMenuItem,
		DropdownMenuTrigger
	} from '$lib/components/ui/dropdown-menu';
	import { Input } from '$lib/components/ui/input';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import MoreVerticalIcon from '@lucide/svelte/icons/more-vertical';
	import FileSignatureIcon from '@lucide/svelte/icons/file-signature';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import CopyIcon from '@lucide/svelte/icons/copy';

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

	// Queries
	const contractsQuery = $derived(getContracts({ search: activeSearch || undefined }));
	const contracts = $derived(contractsQuery.current || []);
	const contractsLoading = $derived(contractsQuery.loading);
	const contractsError = $derived(contractsQuery.error);

	const clientsQuery = getClients();
	const clients = $derived(clientsQuery.current || []);
	const clientMap = $derived(new Map(clients.map((client) => [client.id, client.name])));

	function getStatusVariant(status: string): string {
		switch (status) {
			case 'draft':
				return 'outline';
			case 'sent':
				return 'secondary';
			case 'signed':
				return 'default';
			case 'active':
				return 'default';
			case 'expired':
				return 'destructive';
			case 'cancelled':
				return 'destructive';
			default:
				return 'secondary';
		}
	}

	function getStatusClass(status: string): string {
		if (status === 'active') {
			return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 border-green-200 dark:border-green-800';
		}
		return '';
	}

	function getStatusLabel(status: string): string {
		const labels: Record<string, string> = {
			draft: 'Ciorna',
			sent: 'Trimis',
			signed: 'Semnat',
			active: 'Activ',
			expired: 'Expirat',
			cancelled: 'Anulat'
		};
		return labels[status] || status;
	}

	function formatDate(date: Date | string | null | undefined): string {
		if (!date) return '-';
		try {
			const d = date instanceof Date ? date : new Date(date);
			if (!isNaN(d.getTime()) && d.getFullYear() > 1970) {
				return d.toLocaleDateString('ro-RO', {
					year: 'numeric',
					month: 'short',
					day: 'numeric'
				});
			}
		} catch {
			// ignore
		}
		return '-';
	}

	async function handleDeleteContract(contractId: string) {
		if (!confirm('Esti sigur ca vrei sa stergi acest contract?')) {
			return;
		}

		try {
			await deleteContract(contractId).updates(contractsQuery);
			toast.success('Contractul a fost sters.');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la stergerea contractului');
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
			toast.error(e instanceof Error ? e.message : 'Eroare la duplicarea contractului');
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
		<Button onclick={() => goto(`/${tenantSlug}/contracts/new`)}>
			<PlusIcon class="mr-2 h-4 w-4" />
			Contract Nou
		</Button>
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
											class="text-xs font-semibold px-2 py-0.5 shadow-sm {getStatusClass(contract.status)}"
										>
											{getStatusLabel(contract.status)}
										</Badge>
									{:else}
										<Badge
											variant={getStatusVariant(contract.status)}
											class="text-xs font-semibold px-2 py-0.5 shadow-sm"
										>
											{getStatusLabel(contract.status)}
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
											{formatDate(contract.contractDate)}
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
									onclick={() => window.open(`/${tenantSlug}/contracts/${contract.id}/pdf`, '_blank')}
									title="Descarca PDF"
								>
									<DownloadIcon class="h-3.5 w-3.5" />
								</Button>
								<DropdownMenu>
									<DropdownMenuTrigger>
										<Button
											variant="ghost"
											size="icon"
											class="h-8 w-8 hover:bg-muted transition-all"
										>
											<MoreVerticalIcon class="h-3.5 w-3.5" />
										</Button>
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
										<DropdownMenuItem class="text-destructive" onclick={() => handleDeleteContract(contract.id)}>
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
	{/if}
</div>
