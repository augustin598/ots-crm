<script lang="ts">
	import { getDocuments, getDownloadUrl, deleteDocument } from '$lib/remotes/documents.remote';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Card, CardContent } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import {
		Table,
		TableBody,
		TableCell,
		TableHead,
		TableHeader,
		TableRow
	} from '$lib/components/ui/table';
	import { Plus, Download, Trash2 } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import { clientLogger } from '$lib/client-logger';

	const tenantSlug = $derived(page.params.tenant);
	const taskId = $derived(page.params.taskId);

	const documentsQuery = getDocuments({ taskId } as any);
	const documents = $derived(documentsQuery.current || []);
	const loading = $derived(documentsQuery.loading);

	async function handleDownload(documentId: string) {
		try {
			const result = await getDownloadUrl(documentId);
			window.open(result.url, '_blank');
		} catch (e) {
			clientLogger.apiError('task_document_download', e);
		}
	}

	async function handleDelete(documentId: string) {
		if (!confirm('Are you sure you want to delete this document?')) {
			return;
		}

		try {
			await deleteDocument(documentId).updates(documentsQuery);
		} catch (e) {
			clientLogger.apiError('task_document_delete', e);
		}
	}
</script>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h2 class="text-2xl font-semibold">Documents</h2>
		<Button onclick={() => goto(`/${tenantSlug}/documents/upload?taskId=${taskId}`)}>
			<Plus class="h-4 w-4 mr-2" />
			Upload Document
		</Button>
	</div>

	{#if loading}
		<p>Loading documents...</p>
	{:else if documents.length === 0}
		<Card>
			<CardContent class="pt-6">
				<p class="text-center text-muted-foreground">No documents for this task yet</p>
			</CardContent>
		</Card>
	{:else}
		<Card>
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Name</TableHead>
						<TableHead>Type</TableHead>
						<TableHead>Size</TableHead>
						<TableHead>Uploaded</TableHead>
						<TableHead>Actions</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{#each documents as document}
						<TableRow>
							<TableCell class="font-medium">{document.name}</TableCell>
							<TableCell>{document.type}</TableCell>
							<TableCell>{document.fileSize ? `${(document.fileSize / 1024).toFixed(2)} KB` : '-'}</TableCell>
							<TableCell>{new Date(document.createdAt).toLocaleDateString()}</TableCell>
							<TableCell class="flex gap-2">
								<Button variant="ghost" size="sm" onclick={() => handleDownload(document.id)}>
									<Download class="h-4 w-4 mr-1" />
									Download
								</Button>
								<Button variant="ghost" size="sm" onclick={() => handleDelete(document.id)}>
									<Trash2 class="h-4 w-4 mr-1" />
									Delete
								</Button>
							</TableCell>
						</TableRow>
					{/each}
				</TableBody>
			</Table>
		</Card>
	{/if}
</div>
