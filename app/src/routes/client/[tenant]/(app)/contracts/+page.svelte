<script lang="ts">
	import { getContracts } from '$lib/remotes/contracts.remote';
	import { page } from '$app/state';
	import { Card, CardContent } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import {
		FileText as FileTextIcon,
		Calendar as CalendarIcon,
		Eye as EyeIcon,
		Download as DownloadIcon,
		Search,
		PenLine,
		Upload,
		Coins as CoinsIcon,
		Clock as ClockIcon,
		Repeat as RepeatIcon,
		ArrowRight as ArrowRightIcon,
		CircleCheck as CircleCheckIcon,
		ShieldCheck as ShieldCheckIcon
	} from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import {
		formatContractDate,
		getContractStatusLabel,
		getBillingFrequencyLabel,
		formatContractPrice
	} from '$lib/utils/contract-utils';
	import { formatAmount, type Currency } from '$lib/utils/currency';

	const tenantSlug = $derived(page.params.tenant as string);

	const contractsQuery = getContracts({});
	const contracts = $derived(contractsQuery.current?.contracts || []);
	const loading = $derived(contractsQuery.loading);

	async function handleDownloadPDF(contractId: string, contractNumber: string) {
		try {
			const response = await fetch(`/client/${tenantSlug}/contracts/${contractId}/pdf`);
			if (!response.ok) throw new Error('Failed to generate PDF');
			const blob = await response.blob();
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `Contract-${contractNumber.replace(/[^a-zA-Z0-9-_]/g, '_')}.pdf`;
			a.click();
			URL.revokeObjectURL(url);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la descărcarea PDF');
		}
	}

	async function handlePreviewPDF(contractId: string) {
		try {
			const response = await fetch(`/client/${tenantSlug}/contracts/${contractId}/pdf`);
			if (!response.ok) throw new Error('Failed to generate PDF');
			const blob = await response.blob();
			const url = URL.createObjectURL(blob);
			window.open(url, '_blank');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la previzualizarea PDF');
		}
	}

	// --- State ---
	let searchQuery = $state('');
	let sortColumn = $state<'contractNumber' | 'contractDate' | 'status'>('contractDate');
	let sortDirection = $state<'asc' | 'desc'>('desc');
	let pageSize = $state(10);
	let currentPage = $state(1);

	// --- Derived: filter -> sort -> paginate ---
	const filteredContracts = $derived(
		searchQuery.trim() === ''
			? contracts
			: contracts.filter((c) =>
					c.contractNumber.toLowerCase().includes(searchQuery.trim().toLowerCase()) ||
					c.contractTitle.toLowerCase().includes(searchQuery.trim().toLowerCase())
				)
	);

	const sortedContracts = $derived(
		[...filteredContracts].sort((a, b) => {
			const dir = sortDirection === 'asc' ? 1 : -1;
			switch (sortColumn) {
				case 'contractNumber':
					return dir * a.contractNumber.localeCompare(b.contractNumber, undefined, { numeric: true });
				case 'contractDate': {
					const dateA = a.contractDate ? new Date(a.contractDate).getTime() : 0;
					const dateB = b.contractDate ? new Date(b.contractDate).getTime() : 0;
					return dir * (dateA - dateB);
				}
				case 'status':
					return dir * a.status.localeCompare(b.status);
				default:
					return 0;
			}
		})
	);

	const totalEntries = $derived(filteredContracts.length);
	const totalPages = $derived(Math.max(1, Math.ceil(totalEntries / pageSize)));
	const safePage = $derived(Math.min(Math.max(1, currentPage), totalPages));
	const startIndex = $derived((safePage - 1) * pageSize);
	const endIndex = $derived(Math.min(startIndex + pageSize, totalEntries));
	const paginatedContracts = $derived(sortedContracts.slice(startIndex, endIndex));
	const showingFrom = $derived(totalEntries === 0 ? 0 : startIndex + 1);
	const showingTo = $derived(endIndex);

	const pageNumbers = $derived.by(() => {
		const pages: number[] = [];
		const maxVisible = 5;
		let start = Math.max(1, safePage - Math.floor(maxVisible / 2));
		const end = Math.min(totalPages, start + maxVisible - 1);
		if (end - start + 1 < maxVisible) {
			start = Math.max(1, end - maxVisible + 1);
		}
		for (let i = start; i <= end; i++) {
			pages.push(i);
		}
		return pages;
	});

	$effect(() => {
		if (currentPage > totalPages) {
			currentPage = totalPages;
		}
	});

	function getStatusColor(status: string): string {
		switch (status) {
			case 'signed':
			case 'active':
				return 'border-green-500 text-green-700 bg-green-50 dark:bg-green-900/30 dark:text-green-400 dark:border-green-700';
			case 'sent':
				return 'border-blue-500 text-blue-700 bg-blue-50 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-700';
			case 'draft':
				return 'border-gray-400 text-gray-600 bg-gray-50 dark:bg-gray-800/30 dark:text-gray-400 dark:border-gray-600';
			case 'expired':
				return 'border-orange-400 text-orange-700 bg-orange-50 dark:bg-orange-900/30 dark:text-orange-400 dark:border-orange-700';
			case 'cancelled':
				return 'border-red-400 text-red-600 bg-red-50 dark:bg-red-900/30 dark:text-red-400 dark:border-red-700';
			default:
				return 'border-gray-400 text-gray-600 bg-gray-50 dark:bg-gray-800/30 dark:text-gray-400 dark:border-gray-600';
		}
	}

	function getAccentColor(status: string): string {
		switch (status) {
			case 'signed':
			case 'active':
				return 'bg-green-500';
			case 'sent':
				return 'bg-blue-500';
			case 'draft':
				return 'bg-gray-400';
			case 'expired':
				return 'bg-orange-500';
			case 'cancelled':
				return 'bg-red-500';
			default:
				return 'bg-gray-400';
		}
	}
</script>

<div class="space-y-6">
	<div>
		<h1 class="text-3xl font-bold">Contractele mele</h1>
		<p class="text-muted-foreground">Vizualizați contractele dumneavoastră</p>
	</div>

	{#if loading}
		<p class="text-muted-foreground">Se încarcă contractele...</p>
	{:else if contracts.length === 0}
		<div class="rounded-md border p-8 text-center">
			<p class="text-muted-foreground">Nu există contracte încă.</p>
		</div>
	{:else}
		<!-- Info bar with search and sort -->
		<div class="flex flex-col gap-3 rounded-md bg-muted/50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
			<p class="text-sm text-muted-foreground whitespace-nowrap">
				{showingFrom}–{showingTo} din {totalEntries} contracte
			</p>
			<div class="flex items-center gap-3">
				<!-- Sort dropdown -->
				<div class="flex items-center gap-2">
					<span class="text-sm text-muted-foreground whitespace-nowrap">Sort by:</span>
					<select
						aria-label="Sortare contracte"
						class="h-8 rounded-md border border-input bg-background px-2 text-sm cursor-pointer"
						value={`${sortColumn}-${sortDirection}`}
						onchange={(e) => {
							const val = e.currentTarget.value;
							const [col, dir] = val.split('-') as [typeof sortColumn, 'asc' | 'desc'];
							sortColumn = col;
							sortDirection = dir;
							currentPage = 1;
						}}
					>
						<option value="contractDate-desc">Data (recent)</option>
						<option value="contractDate-asc">Data (vechi)</option>
						<option value="contractNumber-asc">Nr. contract (A-Z)</option>
						<option value="contractNumber-desc">Nr. contract (Z-A)</option>
						<option value="status-asc">Status (A-Z)</option>
						<option value="status-desc">Status (Z-A)</option>
					</select>
				</div>
				<!-- Search -->
				<div class="relative w-64">
					<Search
						class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
						aria-hidden="true"
					/>
					<Input
						type="text"
						placeholder="Caută..."
						aria-label="Caută contracte"
						class="pl-9"
						bind:value={searchQuery}
						oninput={() => {
							currentPage = 1;
						}}
					/>
				</div>
			</div>
		</div>

		<!-- Contract cards -->
		{#if paginatedContracts.length === 0}
			<div class="rounded-md border p-8 text-center">
				<p class="text-muted-foreground">Niciun contract nu corespunde căutării.</p>
			</div>
		{:else}
			<div class="space-y-4">
				{#each paginatedContracts as contract (contract.id)}
					<Card class="group relative overflow-hidden transition-[shadow,transform] duration-300 hover:shadow-lg hover:shadow-primary/5 motion-safe:hover:-translate-y-0.5">
						<!-- Vertical accent bar -->
						<div class="absolute top-0 left-0 bottom-0 w-1 rounded-l-lg {getAccentColor(contract.status)}"></div>

						<CardContent class="p-6 pl-7">
							<!-- Header row -->
							<div class="flex items-center justify-between gap-4">
								<div class="flex items-center gap-3 flex-wrap flex-1 min-w-0">
									<div class="p-2 rounded-xl bg-primary/10 group-hover:bg-primary/20 transition-colors">
										<FileTextIcon class="h-4 w-4 text-primary" aria-hidden="true" />
									</div>
									<h3 class="text-xl font-bold tracking-tight text-foreground">
										{contract.contractNumber}
									</h3>
									<span class="text-sm text-muted-foreground truncate max-w-sm">
										{contract.contractTitle}
									</span>
									<span
										class="inline-flex items-center rounded-full border px-3 py-0.5 text-xs font-medium {getStatusColor(contract.status)}"
									>
										{getContractStatusLabel(contract.status)}
									</span>
									{#if contract.uploadedFilePath}
										<span class="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-violet-50 px-2.5 py-0.5 text-xs font-medium text-violet-700 dark:bg-violet-900/30 dark:text-violet-400 dark:border-violet-700">
											<Upload class="h-3 w-3" />
											Încărcat
										</span>
									{/if}
								</div>

								<!-- Action buttons -->
								<div class="flex items-center gap-2 flex-shrink-0">
									<Button
										variant="outline"
										size="sm"
										class="cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors"
										onclick={() => handlePreviewPDF(contract.id)}
									>
										<EyeIcon class="h-4 w-4 mr-1.5" aria-hidden="true" />
										Vizualizare
									</Button>
									<Button
										variant="outline"
										size="sm"
										class="cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors"
										onclick={() => handleDownloadPDF(contract.id, contract.contractNumber)}
									>
										<DownloadIcon class="h-4 w-4 mr-1.5" aria-hidden="true" />
										Descarcă PDF
									</Button>
								</div>
							</div>

							<!-- Info grid -->
							<div class="mt-5 grid gap-4 grid-cols-1 md:grid-cols-3">
								<!-- Value + TVA combined -->
								<div class="relative p-4 rounded-xl bg-gradient-to-br from-primary/5 to-primary/10 border border-primary/10 group-hover:border-primary/20 transition-colors">
									<div class="flex items-center gap-1.5 mb-2">
										<CoinsIcon class="h-4 w-4 text-primary/60" aria-hidden="true" />
										<p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Valoare</p>
									</div>
									<p class="text-2xl font-bold text-primary leading-tight">
										{formatAmount(Number(contract.totalWithTVA) || 0, contract.currency as Currency)}
									</p>
									<div class="mt-2 pt-2 border-t border-primary/10 space-y-0.5">
										<p class="text-xs text-muted-foreground">
											Fără TVA: {formatAmount(Number(contract.totalPrice) || 0, contract.currency as Currency)}
										</p>
										<p class="text-xs text-muted-foreground">
											TVA {contract.taxRate}%: {formatAmount(Number(contract.tvaAmount) || 0, contract.currency as Currency)}
										</p>
									</div>
								</div>

								<!-- Contract Date + Duration -->
								<div class="p-4 rounded-xl bg-muted/30 border border-border/50 group-hover:bg-muted/50 transition-colors">
									<div class="flex items-center gap-1.5 mb-2">
										<CalendarIcon class="h-4 w-4 text-muted-foreground/60" aria-hidden="true" />
										<p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Data contractului</p>
									</div>
									<p class="text-lg font-bold text-foreground">
										{formatContractDate(contract.contractDate)}
									</p>
									<div class="mt-2 pt-2 border-t border-border/50 flex items-center gap-3">
										<div class="flex items-center gap-1.5">
											<ClockIcon class="h-3.5 w-3.5 text-muted-foreground/60" aria-hidden="true" />
											<span class="text-xs text-muted-foreground font-medium">
												{contract.contractDurationMonths} {contract.contractDurationMonths === 1 ? 'lună' : 'luni'}
											</span>
										</div>
										<div class="flex items-center gap-1.5">
											<RepeatIcon class="h-3.5 w-3.5 text-muted-foreground/60" aria-hidden="true" />
											<span class="text-xs text-muted-foreground font-medium">
												{getBillingFrequencyLabel(contract.billingFrequency)}
											</span>
										</div>
									</div>
								</div>

								<!-- Status / Signing -->
								{#if contract.status === 'sent' && (contract as any).signingUrl}
									<a
										href={(contract as any).signingUrl}
										target="_blank"
										rel="noopener noreferrer"
										class="signing-card group/sign flex flex-col items-center justify-center gap-3 p-4 rounded-xl bg-gradient-to-br from-amber-400 to-amber-500 dark:from-amber-500 dark:to-amber-600 text-white no-underline shadow-md shadow-amber-200/50 dark:shadow-amber-900/30 hover:shadow-lg hover:shadow-amber-300/50 hover:from-amber-500 hover:to-amber-600 hover:scale-[1.03] active:scale-[0.98] transition-all duration-200 cursor-pointer"
									>
										<div class="flex items-center justify-center w-12 h-12 rounded-full bg-white/20 group-hover/sign:bg-white/30 transition-colors">
											<PenLine class="h-6 w-6" aria-hidden="true" />
										</div>
										<span class="text-base font-bold tracking-wide">Semnează acum</span>
										<span class="flex items-center gap-1 text-xs font-medium text-white/80 group-hover/sign:text-white transition-colors">
											Deschide pagina de semnare
											<ArrowRightIcon class="h-3.5 w-3.5 group-hover/sign:translate-x-0.5 transition-transform" />
										</span>
									</a>
								{:else if contract.status === 'sent'}
									<div class="flex flex-col items-center justify-center gap-3 p-4 rounded-xl bg-amber-50 border-2 border-amber-300 dark:bg-amber-950/30 dark:border-amber-600">
										<div class="flex items-center justify-center w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-900/50">
											<PenLine class="h-6 w-6 text-amber-600 motion-safe:animate-pulse" aria-hidden="true" />
										</div>
										<span class="text-base font-bold text-amber-800 dark:text-amber-300">Necesită semnătura</span>
										<span class="text-xs text-amber-600 dark:text-amber-400">Link-ul va fi trimis pe email</span>
									</div>
								{:else if contract.status === 'signed' || contract.status === 'active'}
									<div class="flex flex-col items-center justify-center gap-3 p-4 rounded-xl bg-gradient-to-br from-green-50 to-emerald-50 border border-green-200 dark:from-green-950/30 dark:to-emerald-950/30 dark:border-green-800">
										<div class="flex items-center justify-center w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/50">
											{#if contract.status === 'signed'}
												<CircleCheckIcon class="h-6 w-6 text-green-600 dark:text-green-400" aria-hidden="true" />
											{:else}
												<ShieldCheckIcon class="h-6 w-6 text-green-600 dark:text-green-400" aria-hidden="true" />
											{/if}
										</div>
										<span class="text-base font-bold text-green-700 dark:text-green-300">
											{contract.status === 'signed' ? 'Contract semnat' : 'Contract activ'}
										</span>
										<span class="text-xs text-green-600/80 dark:text-green-400/80">
											{contract.status === 'signed' ? 'Semnat cu succes' : 'În vigoare'}
										</span>
									</div>
								{:else}
									<div class="flex flex-col items-center justify-center gap-3 p-4 rounded-xl {contract.status === 'expired' ? 'bg-orange-50 border border-orange-200 dark:bg-orange-950/20 dark:border-orange-800' : contract.status === 'cancelled' ? 'bg-red-50 border border-red-200 dark:bg-red-950/20 dark:border-red-800' : 'bg-muted/30 border border-border/50'}">
										<div class="flex items-center justify-center w-12 h-12 rounded-full {contract.status === 'expired' ? 'bg-orange-100 dark:bg-orange-900/50' : contract.status === 'cancelled' ? 'bg-red-100 dark:bg-red-900/50' : 'bg-muted'}">
											<FileTextIcon class="h-6 w-6 {contract.status === 'expired' ? 'text-orange-500' : contract.status === 'cancelled' ? 'text-red-500' : 'text-muted-foreground'}" aria-hidden="true" />
										</div>
										<span class="text-base font-bold {contract.status === 'expired' ? 'text-orange-700 dark:text-orange-300' : contract.status === 'cancelled' ? 'text-red-600 dark:text-red-400' : 'text-foreground'}">
											{getContractStatusLabel(contract.status)}
										</span>
									</div>
								{/if}
							</div>
						</CardContent>
					</Card>
				{/each}
			</div>
		{/if}

		<!-- Pagination -->
		{#if totalEntries > 0}
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-2 text-sm">
					<span class="text-muted-foreground">Arată</span>
					<select
						aria-label="Contracte pe pagină"
						class="h-8 w-[70px] rounded-md border border-input bg-background px-2 text-sm cursor-pointer"
						value={pageSize.toString()}
						onchange={(e) => {
							pageSize = parseInt(e.currentTarget.value);
							currentPage = 1;
						}}
					>
						<option value="10">10</option>
						<option value="25">25</option>
						<option value="50">50</option>
						<option value="100">100</option>
					</select>
					<span class="text-muted-foreground">contracte</span>
				</div>

				<div class="flex items-center gap-1">
					<Button
						variant="outline"
						size="sm"
						disabled={safePage <= 1}
						onclick={() => {
							currentPage = safePage - 1;
						}}
					>
						Anterior
					</Button>
					{#each pageNumbers as pn (pn)}
						<Button
							variant={pn === safePage ? 'default' : 'outline'}
							size="sm"
							class="w-8 h-8 p-0"
							onclick={() => {
								currentPage = pn;
							}}
						>
							{pn}
						</Button>
					{/each}
					<Button
						variant="outline"
						size="sm"
						disabled={safePage >= totalPages}
						onclick={() => {
							currentPage = safePage + 1;
						}}
					>
						Următor
					</Button>
				</div>
			</div>
		{/if}
	{/if}
</div>

<style>
	@media (prefers-reduced-motion: no-preference) {
		:global(.signing-card) {
			animation: signing-glow 2s ease-in-out infinite;
		}
	}

	@keyframes signing-glow {
		0%, 100% {
			box-shadow: 0 4px 6px -1px rgba(245, 158, 11, 0.3), 0 0 0 0 rgba(245, 158, 11, 0);
		}
		50% {
			box-shadow: 0 4px 15px -1px rgba(245, 158, 11, 0.4), 0 0 20px 4px rgba(245, 158, 11, 0.15);
		}
	}
</style>
