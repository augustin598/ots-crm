<script lang="ts">
	import { getContractTemplate } from '$lib/remotes/contract-templates.remote';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';

	const tenantSlug = $derived(page.params.tenant);
	const templateId = $derived(page.params.templateId);

	const templateQuery = getContractTemplate(templateId);
	const template = $derived(templateQuery.current);
	const loading = $derived(templateQuery.loading);
</script>

<div class="space-y-6">
	{#if loading}
		<p>Loading template...</p>
	{:else if template}
		<div class="flex items-center justify-between">
			<h1 class="text-3xl font-bold">{template.name}</h1>
			<div class="flex gap-2">
				<Button onclick={() => goto(`/${tenantSlug}/contract-templates/${template.id}/generate`)}>
					Generate Contract
				</Button>
			</div>
		</div>

		<Card>
			<CardHeader>
				<CardTitle>Template Details</CardTitle>
				<CardDescription>{template.description || 'No description'}</CardDescription>
			</CardHeader>
			<CardContent>
				<div class="space-y-2">
					<div>
						<span class="font-semibold">Status:</span> {template.isActive ? 'Active' : 'Inactive'}
					</div>
					<div class="mt-4">
						<span class="font-semibold">Content:</span>
						<pre class="mt-2 p-4 bg-gray-50 rounded border whitespace-pre-wrap">{template.content}</pre>
					</div>
				</div>
			</CardContent>
		</Card>
	{/if}
</div>
