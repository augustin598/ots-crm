<script lang="ts">
	import { createContractTemplate } from '$lib/remotes/contract-templates.remote';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';

	const tenantSlug = $derived(page.params.tenant);

	let name = $state('');
	let description = $state('');
	let content = $state('');
	let isActive = $state(true);
	let loading = $state(false);
	let error = $state<string | null>(null);

	async function handleSubmit() {
		if (!name || !content) {
			error = 'Name and content are required';
			return;
		}

		loading = true;
		error = null;

		try {
			const result = await createContractTemplate({
				name,
				description: description || undefined,
				content,
				isActive: isActive
			});

			if (result.success) {
				goto(`/${tenantSlug}/contract-templates`);
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to create template';
		} finally {
			loading = false;
		}
	}
</script>

<div class="space-y-6">
	<h1 class="text-3xl font-bold">New Contract Template</h1>

	<Card>
		<CardHeader>
			<CardTitle>Template Information</CardTitle>
			<CardDescription>Create a new contract template with variables like {'{{tenant.name}}'}, {'{{client.name}}'}, etc.</CardDescription>
		</CardHeader>
		<CardContent>
			<form
				onsubmit={(e) => {
					e.preventDefault();
					handleSubmit();
				}}
				class="space-y-4"
			>
				<div class="space-y-2">
					<Label for="name">Template Name *</Label>
					<Input id="name" bind:value={name} type="text" required />
				</div>
				<div class="space-y-2">
					<Label for="description">Description</Label>
					<Input id="description" bind:value={description} type="text" />
				</div>
				<div class="space-y-2">
					<Label for="content">Template Content *</Label>
					<Textarea id="content" bind:value={content} rows="20" required />
					<p class="text-xs text-gray-500">
						Use variables like {'{{tenant.name}}'}, {'{{client.name}}'}, {'{{client.cui}}'}, {'{{project.name}}'}, {'{{date}}'}
					</p>
				</div>

				{#if error}
					<div class="rounded-md bg-red-50 p-3">
						<p class="text-sm text-red-800">{error}</p>
					</div>
				{/if}

				<div class="flex items-center justify-end gap-4">
					<Button type="button" variant="outline" onclick={() => goto(`/${tenantSlug}/contract-templates`)}>
						Cancel
					</Button>
					<Button type="submit" disabled={loading}>
						{loading ? 'Creating...' : 'Create Template'}
					</Button>
				</div>
			</form>
		</CardContent>
	</Card>
</div>
