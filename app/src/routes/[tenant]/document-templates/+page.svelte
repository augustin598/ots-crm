<script lang="ts">
	import { getDocumentTemplates, deleteDocumentTemplate } from '$lib/remotes/document-templates.remote';
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
	import { Trash2, Edit, Plus } from '@lucide/svelte';

	const tenantSlug = $derived(page.params.tenant);
	let selectedType = $state<string | undefined>(undefined);

	const templatesQuery = getDocumentTemplates({ type: selectedType });
	const templates = $derived(templatesQuery.current || []);
	const loading = $derived(templatesQuery.loading);

	async function handleDelete(templateId: string) {
		if (!confirm('Are you sure you want to delete this template?')) {
			return;
		}

		try {
			await deleteDocumentTemplate(templateId).updates(templatesQuery);
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Failed to delete template');
		}
	}

	function getTypeBadgeVariant(type: string) {
		return type === 'offer' ? 'default' : 'secondary';
	}
</script>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h1 class="text-3xl font-bold">Document Templates</h1>
		<Button onclick={() => goto(`/${tenantSlug}/document-templates/new`)}>
			<Plus class="mr-2 h-4 w-4" />
			New Template
		</Button>
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
							: 'Generic'}
				{:else}
					All Types
				{/if}
			</SelectTrigger>
			<SelectContent>
				<SelectItem value="all">All Types</SelectItem>
				<SelectItem value="offer">Offers</SelectItem>
				<SelectItem value="contract">Contracts</SelectItem>
				<SelectItem value="generic">Generic</SelectItem>
			</SelectContent>
		</Select>
	</div>

	{#if loading}
		<p>Loading...</p>
	{:else if templates.length === 0}
		<Card>
			<CardContent class="pt-6">
				<p class="text-center text-gray-500">No templates yet</p>
			</CardContent>
		</Card>
	{:else}
		<Card>
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Name</TableHead>
						<TableHead>Type</TableHead>
						<TableHead>Description</TableHead>
						<TableHead>Status</TableHead>
						<TableHead>Actions</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{#each templates as template}
						<TableRow>
							<TableCell class="font-medium">{template.name}</TableCell>
							<TableCell>
								<Badge variant={getTypeBadgeVariant(template.type)}>
									{template.type}
								</Badge>
							</TableCell>
							<TableCell>{template.description || '-'}</TableCell>
							<TableCell>
								<Badge variant={template.isActive ? 'default' : 'secondary'}>
									{template.isActive ? 'Active' : 'Inactive'}
								</Badge>
							</TableCell>
							<TableCell class="flex gap-2">
								<Button
									variant="ghost"
									size="sm"
									onclick={() => goto(`/${tenantSlug}/document-templates/${template.id}/edit`)}
								>
									<Edit class="h-4 w-4" />
								</Button>
								<Button
									variant="ghost"
									size="sm"
									onclick={() => handleDelete(template.id)}
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
