<script lang="ts">
	import { getContracts } from '$lib/remotes/contracts.remote';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Card, CardContent } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { FileText, Plus, ExternalLink } from '@lucide/svelte';

	const tenantSlug = $derived(page.params.tenant);
	const clientId = $derived(page.params.clientId);

	const contractsQuery = getContracts({ clientId });
	const contracts = $derived(contractsQuery.current || []);
	const loading = $derived(contractsQuery.loading);

	function getStatusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
		switch (status) {
			case 'signed': return 'default';
			case 'sent': return 'secondary';
			case 'draft': return 'outline';
			case 'cancelled': return 'destructive';
			default: return 'outline';
		}
	}

	function getStatusLabel(status: string): string {
		switch (status) {
			case 'draft': return 'Ciornă';
			case 'sent': return 'Trimis';
			case 'signed': return 'Semnat';
			case 'cancelled': return 'Anulat';
			default: return status;
		}
	}
</script>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h2 class="text-2xl font-semibold">Contracte</h2>
		<Button onclick={() => goto(`/${tenantSlug}/contracts/new`)}>
			<Plus class="mr-2 h-4 w-4" />
			Contract Nou
		</Button>
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
								<div class="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
									<FileText class="h-5 w-5 text-primary" />
								</div>
								<div>
									<p class="text-lg font-semibold">{contract.contractNumber}</p>
									{#if contract.contractTitle}
										<p class="text-sm text-muted-foreground">{contract.contractTitle}</p>
									{/if}
									<div class="flex items-center gap-3 mt-1">
										<Badge variant={getStatusVariant(contract.status)}>
											{getStatusLabel(contract.status)}
										</Badge>
										{#if contract.contractDate}
											<span class="text-sm text-muted-foreground">
												{new Date(contract.contractDate).toLocaleDateString('ro-RO')}
											</span>
										{/if}
									</div>
								</div>
							</div>
							<div class="flex items-center gap-2">
								<Button
									variant="outline"
									onclick={() => window.open(`/${tenantSlug}/contracts/${contract.id}/pdf`, '_blank')}
								>
									<ExternalLink class="h-4 w-4 mr-2" />
									PDF
								</Button>
								<Button onclick={() => goto(`/${tenantSlug}/contracts/${contract.id}`)}>
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
