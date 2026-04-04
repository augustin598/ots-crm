<script lang="ts">
	import { getDocumentTemplate, updateDocumentTemplate } from '$lib/remotes/document-templates.remote';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Select, SelectContent, SelectItem, SelectTrigger } from '$lib/components/ui/select';
	import DocumentTemplateEditor from '$lib/components/document-template-editor.svelte';

	const tenantSlug = $derived(page.params.tenant);
	const templateId = $derived(page.params.templateId || '');

	const templateQuery = $derived(getDocumentTemplate(templateId));
	const template = $derived(templateQuery.current);
	const loading = $derived(templateQuery.loading);

	let name = $state('');
	let description = $state('');
	let type = $state<'offer' | 'contract' | 'generic'>('offer');
	let content = $state('');
	let variables = $state<Array<{ key: string; label: string; defaultValue?: string }>>([]);
	let styling = $state<{
		primaryColor?: string;
		secondaryColor?: string;
		fontFamily?: string;
		fontSize?: string;
		header?: { content: string; height?: number };
		footer?: { content: string; height?: number };
	} | null>(null);
	let saving = $state(false);
	let error = $state<string | null>(null);

	// Initialize form when template loads
	$effect(() => {
		if (template) {
			name = template.name;
			description = template.description || '';
			type = template.type as 'offer' | 'generic';
			content = template.content;
			variables = (template.variables as Array<{ key: string; label: string; defaultValue?: string }>) || [];
			styling = (template.styling as typeof styling) || null;
		}
	});

	async function handleSubmit() {
		if (!name || !content) {
			error = 'Name and content are required';
			return;
		}

		saving = true;
		error = null;

		try {
			const result = await updateDocumentTemplate({
				templateId,
				data: {
					name,
					description: description || undefined,
					type,
					content,
					variables: variables.length > 0 ? variables : undefined,
					styling: styling || undefined
				}
			});

			if (result.success) {
				goto(`/${tenantSlug}/document-templates`);
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to update template';
		} finally {
			saving = false;
		}
	}
</script>

<div class="space-y-6">
	<h1 class="text-3xl font-bold">Edit Document Template</h1>

	{#if loading}
		<p>Loading template...</p>
	{:else if !template}
		<p>Template not found</p>
	{:else}
		<Card>
			<CardHeader>
				<CardTitle>Template Information</CardTitle>
				<CardDescription>Edit your document template with variables and styling</CardDescription>
			</CardHeader>
			<CardContent>
				<form
					onsubmit={(e) => {
						e.preventDefault();
						handleSubmit();
					}}
					class="space-y-6"
				>
					<div class="grid grid-cols-2 gap-4">
						<div class="space-y-2">
							<Label for="name">Template Name *</Label>
							<Input id="name" bind:value={name} type="text" required />
						</div>
						<div class="space-y-2">
							<Label for="type">Type *</Label>
							<Select value={type} type="single" onValueChange={(value) => (type = value as 'offer' | 'contract' | 'generic')}>
								<SelectTrigger id="type">
									{type === 'offer' ? 'Offer' : type === 'contract' ? 'Contract' : 'Generic'}
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="offer">Offer</SelectItem>
									<SelectItem value="contract">Contract</SelectItem>
									<SelectItem value="generic">Generic</SelectItem>
								</SelectContent>
							</Select>
						</div>
					</div>

					<div class="space-y-2">
						<Label for="description">Description</Label>
						<Input id="description" bind:value={description} type="text" />
					</div>

					<DocumentTemplateEditor
						{name}
						{description}
						{type}
						{content}
						{variables}
						{styling}
						onNameChange={(value) => (name = value)}
						onDescriptionChange={(value) => (description = value)}
						onTypeChange={(value) => (type = value)}
						onContentChange={(value) => (content = value)}
						onVariablesChange={(value) => (variables = value)}
						onStylingChange={(value) => (styling = value)}
					/>

					{#if error}
						<div class="rounded-md bg-red-50 p-3">
							<p class="text-sm text-red-800">{error}</p>
						</div>
					{/if}

					<div class="flex items-center justify-end gap-4">
						<Button type="button" variant="outline" onclick={() => goto(`/${tenantSlug}/document-templates`)}>
							Cancel
						</Button>
						<Button type="submit" disabled={saving}>
							{saving ? 'Saving...' : 'Save Template'}
						</Button>
					</div>
				</form>
			</CardContent>
		</Card>
	{/if}
</div>
