<script lang="ts">
	import {
		getDocuments,
		getDownloadUrl,
		deleteDocument,
		generateDocumentPDF,
		getDocumentPreview
	} from '$lib/remotes/documents.remote';
	import { getClients } from '$lib/remotes/clients.remote';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Card, CardContent } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import {
		Table,
		TableBody,
		TableCell,
		TableHead,
		TableHeader,
		TableRow
	} from '$lib/components/ui/table';
	import { Select, SelectContent, SelectItem, SelectTrigger } from '$lib/components/ui/select';
	import {
		Dialog,
		DialogContent,
		DialogDescription,
		DialogHeader,
		DialogTitle
	} from '$lib/components/ui/dialog';
	import DocumentViewer from '$lib/components/document-viewer.svelte';
	import { Download, Eye, FileText, Trash2, Plus } from '@lucide/svelte';

	const tenantSlug = $derived(page.params.tenant);

	// Filters
	let selectedType = $state<string | undefined>(undefined);
	let selectedClientId = $state<string | undefined>(undefined);

	// Fetch data
	const documentsQuery = getDocuments({
		clientId: selectedClientId,
		projectId: undefined
	});
	const documents = $derived(documentsQuery.current || []);

	const clientsQuery = getClients();
	const clients = $derived(clientsQuery.current || []);

	const loading = $derived(documentsQuery.loading);

	// Preview state
	let previewDocumentId = $state<string | null>(null);
	let previewHtml = $state<string>('');
	let previewLoading = $state(false);
	let previewPdfUrl = $state<string | undefined>(undefined);

	// Filter documents by type
	const filteredDocuments = $derived(() => {
		if (!selectedType) return documents;
		return documents.filter((d) => d.type === selectedType);
	});

	async function handleDownload(documentId: string) {
		try {
			const result = await getDownloadUrl(documentId);
			window.open(result.url, '_blank');
		} catch (e) {
			alert('Failed to download document');
		}
	}

	async function handleGeneratePDF(documentId: string) {
		try {
			const result = await generateDocumentPDF(documentId);
			if (result.url) {
				window.open(result.url, '_blank');
			}
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Failed to generate PDF');
		}
	}

	async function handlePreview(documentId: string) {
		previewDocumentId = documentId;
		previewLoading = true;
		previewHtml = '';
		previewPdfUrl = undefined;

		try {
			const result = await getDocumentPreview(documentId);
			previewHtml = result.html || '';
			// Try to get PDF URL if available
			if (result.document.pdfGenerated) {
				const downloadResult = await getDownloadUrl(documentId);
				previewPdfUrl = downloadResult.url;
			}
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Failed to load preview');
			previewDocumentId = null;
		} finally {
			previewLoading = false;
		}
	}

	async function handleDelete(documentId: string) {
		if (!confirm('Are you sure you want to delete this document?')) {
			return;
		}

		try {
			await deleteDocument(documentId).updates(documentsQuery);
			if (previewDocumentId === documentId) {
				previewDocumentId = null;
			}
		} catch (e) {
			alert('Failed to delete document');
		}
	}

	function getTypeBadgeVariant(type: string) {
		switch (type) {
			case 'offer':
				return 'default';
			case 'contract':
				return 'secondary';
			case 'proposal':
				return 'outline';
			default:
				return 'outline';
		}
	}
</script>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h1 class="text-3xl font-bold">Documents</h1>
		<div class="flex gap-2">
			<Button variant="outline" onclick={() => goto(`/${tenantSlug}/documents/upload`)}>
				Upload Document
			</Button>
			<Button onclick={() => goto(`/${tenantSlug}/documents/new`)}>
				<Plus class="mr-2 h-4 w-4" />
				Create from Template
			</Button>
		</div>
	</div>

	<!-- Filters -->
	<div class="flex items-center gap-4">
		<Select
			value={selectedType || 'all'}
			type="single"
			onValueChange={(value: string | undefined) => {
				selectedType = value === 'all' ? undefined : value;
			}}
		>
			<SelectTrigger class="w-[180px]">
				{#if selectedType}
					{selectedType === 'offer'
						? 'Offers'
						: selectedType === 'contract'
							? 'Contracts'
							: selectedType === 'other'
								? 'Other'
								: 'All Types'}
				{:else}
					All Types
				{/if}
			</SelectTrigger>
			<SelectContent>
				<SelectItem value="all">All Types</SelectItem>
				<SelectItem value="offer">Offers</SelectItem>
				<SelectItem value="contract">Contracts</SelectItem>
				<SelectItem value="other">Other</SelectItem>
			</SelectContent>
		</Select>

		<Select
			value={selectedClientId || 'all'}
			type="single"
			onValueChange={(value: string | undefined) => {
				selectedClientId = value === 'all' ? undefined : value;
			}}
		>
			<SelectTrigger class="w-[200px]">
				{#if selectedClientId}
					{clients.find((c) => c.id === selectedClientId)?.name || 'All Clients'}
				{:else}
					All Clients
				{/if}
			</SelectTrigger>
			<SelectContent>
				<SelectItem value="all">All Clients</SelectItem>
				{#each clients as client}
					<SelectItem value={client.id}>{client.name}</SelectItem>
				{/each}
			</SelectContent>
		</Select>
	</div>

	{#if loading}
		<p>Loading documents...</p>
	{:else if filteredDocuments().length === 0}
		<Card>
			<CardContent class="pt-6">
				<p class="text-center text-gray-500">No documents found</p>
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
					{#each filteredDocuments() as document}
						<TableRow>
							<TableCell class="font-medium">{document.name}</TableCell>
							<TableCell>
								<Badge variant={getTypeBadgeVariant(document.type)}>{document.type}</Badge>
							</TableCell>
							<TableCell>
								{document.fileSize ? `${(document.fileSize / 1024).toFixed(2)} KB` : '-'}
							</TableCell>
							<TableCell>{new Date(document.createdAt).toLocaleDateString()}</TableCell>
							<TableCell class="flex gap-2">
								<Button
									variant="ghost"
									size="sm"
									onclick={() => handlePreview(document.id)}
									title="Preview"
								>
									<Eye class="h-4 w-4" />
								</Button>
								{#if document.documentTemplateId && !document.pdfGenerated}
									<Button
										variant="ghost"
										size="sm"
										onclick={() => handleGeneratePDF(document.id)}
										title="Generate PDF"
									>
										<FileText class="h-4 w-4" />
									</Button>
								{/if}
								<Button
									variant="ghost"
									size="sm"
									onclick={() => handleDownload(document.id)}
									title="Download"
								>
									<Download class="h-4 w-4" />
								</Button>
								<Button
									variant="ghost"
									size="sm"
									onclick={() => handleDelete(document.id)}
									title="Delete"
								>
									<Trash2 class="h-4 w-4" />
								</Button>
							</TableCell>
						</TableRow>
					{/each}
				</TableBody>
			</Table>
		</Card>
	{/if}
</div>

<!-- Preview Dialog -->
<Dialog
	open={previewDocumentId !== null}
	onOpenChange={(open) => {
		if (!open) previewDocumentId = null;
	}}
>
	<DialogContent class="max-w-4xl max-h-[90vh] overflow-y-auto">
		<DialogHeader>
			<DialogTitle>Document Preview</DialogTitle>
			<DialogDescription>Preview of the rendered document</DialogDescription>
		</DialogHeader>
		<div class="h-[70vh] overflow-auto">
			{#if previewLoading}
				<div class="flex items-center justify-center h-full">
					<p>Loading preview...</p>
				</div>
			{:else if previewHtml}
				<DocumentViewer
					html={previewHtml}
					pdfUrl={previewPdfUrl}
					onDownloadPDF={() => {
						if (previewPdfUrl) {
							window.open(previewPdfUrl, '_blank');
						} else if (previewDocumentId) {
							handleGeneratePDF(previewDocumentId);
						}
					}}
				/>
			{/if}
		</div>
	</DialogContent>
</Dialog>
