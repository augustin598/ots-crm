<script lang="ts">
	import { getDocuments, getDownloadUrl } from '$lib/remotes/documents.remote';
	import { page } from '$app/state';
	import { Card, CardContent, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { FileText, Download } from '@lucide/svelte';

	const tenantSlug = $derived(page.params.tenant as string);

	const documentsQuery = getDocuments({});
	const documents = $derived(documentsQuery.current || []);
	const contracts = $derived(documents.filter((d) => d.type === 'contract'));
	const loading = $derived(documentsQuery.loading);

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

	function formatDate(date: Date | string | null | undefined): string {
		if (!date) return '-';
		try {
			const d = date instanceof Date ? date : new Date(date);
			return d.toLocaleDateString('ro-RO', { year: 'numeric', month: 'short', day: 'numeric' });
		} catch {
			return '-';
		}
	}
</script>

<div class="space-y-6">
	<div>
		<h1 class="text-3xl font-bold">Contracts</h1>
		<p class="text-muted-foreground">View your contracts</p>
	</div>

	{#if loading}
		<p class="text-muted-foreground">Loading contracts...</p>
	{:else if contracts.length === 0}
		<Card>
			<CardContent class="pt-6">
				<p class="text-center text-muted-foreground">No contracts yet.</p>
			</CardContent>
		</Card>
	{:else}
		<div class="space-y-4">
			{#each contracts as contract}
				<Card>
					<CardHeader>
						<div class="flex items-start justify-between">
							<div class="flex items-center gap-3">
								<FileText class="h-5 w-5 text-muted-foreground" />
								<div>
									<CardTitle class="text-lg">{contract.name}</CardTitle>
									<p class="text-sm text-muted-foreground">Created: {formatDate(contract.createdAt)}</p>
								</div>
							</div>
							<Button variant="outline" onclick={() => handleDownload(contract.id)}>
								<Download class="mr-2 h-4 w-4" />
								Download
							</Button>
						</div>
					</CardHeader>
				</Card>
			{/each}
		</div>
	{/if}
</div>
