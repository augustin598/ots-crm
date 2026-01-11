<script lang="ts">
	import { getDocuments, getDownloadUrl, generateDocumentPDF } from '$lib/remotes/documents.remote';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Card, CardContent } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { FileText, Download, Plus, FileDown } from '@lucide/svelte';

	const tenantSlug = $derived(page.params.tenant);
	const clientId = $derived(page.params.clientId);

	const documentsQuery = getDocuments({ clientId });
	const documents = $derived(documentsQuery.current || []);
	const loading = $derived(documentsQuery.loading);

	const contracts = $derived(documents.filter((d) => d.type === 'contract'));

	async function handleDownload(id: string) {
		try {
			const { url } = await getDownloadUrl(id);
			if (url) {
				window.open(url, '_blank');
			}
		} catch (e) {
			alert('Failed to download document');
		}
	}

	async function handleGeneratePDF(id: string) {
		try {
			const result = await generateDocumentPDF(id);
			if (result.url) {
				window.open(result.url, '_blank');
			}
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Failed to generate PDF');
		}
	}
</script>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h2 class="text-2xl font-semibold">Contracts</h2>
		<Button onclick={() => goto(`/${tenantSlug}/documents/new?type=contract&clientId=${clientId}`)}>
			<Plus class="mr-2 h-4 w-4" />
			Create Contract
		</Button>
	</div>

	{#if loading}
		<p>Loading...</p>
	{:else if contracts.length === 0}
		<Card>
			<CardContent class="pt-6">
				<p class="text-center text-muted-foreground">No contracts for this client yet</p>
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
									<p class="text-lg font-semibold">{contract.name}</p>
									<div class="flex items-center gap-3 mt-1">
										<Badge variant="secondary">Contract</Badge>
										<p class="text-sm text-muted-foreground">
											Created {contract.createdAt ? new Date(contract.createdAt).toLocaleDateString() : '—'}
										</p>
									</div>
								</div>
							</div>
							<div class="flex items-center gap-2">
								{#if contract.documentTemplateId && !contract.pdfGenerated}
									<Button variant="outline" onclick={() => handleGeneratePDF(contract.id)}>
										<FileDown class="h-4 w-4 mr-2" />
										Generate PDF
									</Button>
								{/if}
								<Button variant="outline" onclick={() => handleDownload(contract.id)}>
									<Download class="h-4 w-4 mr-2" />
									Download
								</Button>
							</div>
						</div>
					</CardContent>
				</Card>
			{/each}
		</div>
	{/if}
</div>

