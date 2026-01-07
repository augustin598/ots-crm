<script lang="ts">
	import { getContractTemplates } from '$lib/remotes/contract-templates.remote';
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

	const tenantSlug = $derived(page.params.tenant);
	const templatesQuery = getContractTemplates();
	const templates = $derived(templatesQuery.current || []);
	const loading = $derived(templatesQuery.loading);
</script>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h1 class="text-3xl font-bold">Contract Templates</h1>
		<Button onclick={() => goto(`/${tenantSlug}/contract-templates/new`)}>New Template</Button>
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
						<TableHead>Description</TableHead>
						<TableHead>Status</TableHead>
						<TableHead>Actions</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{#each templates as template}
						<TableRow>
							<TableCell class="font-medium">{template.name}</TableCell>
							<TableCell>{template.description || '-'}</TableCell>
							<TableCell>{template.isActive ? 'Active' : 'Inactive'}</TableCell>
							<TableCell class="flex gap-2">
								<Button variant="ghost" size="sm" onclick={() => goto(`/${tenantSlug}/contract-templates/${template.id}`)}>
									View
								</Button>
								<Button variant="ghost" size="sm" onclick={() => goto(`/${tenantSlug}/contract-templates/${template.id}/generate`)}>
									Generate
								</Button>
							</TableCell>
						</TableRow>
					{/each}
				</TableBody>
			</Table>
		</Card>
	{/if}
</div>
