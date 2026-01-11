<script lang="ts">
	import { createDocumentTemplate } from '$lib/remotes/document-templates.remote';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Select, SelectContent, SelectItem, SelectTrigger } from '$lib/components/ui/select';
	import DocumentTemplateEditor from '$lib/components/document-template-editor.svelte';

	const tenantSlug = $derived(page.params.tenant);

	let name = $state('');
	let description = $state('');
	let type = $state<'offer' | 'contract' | 'generic'>('offer');
	let content = $state('# Document Title\n\nContent goes here. Use variables like {{client.name}}.\n\n- Use **bold** or *italic* text\n- Create lists\n- Format easily with Markdown');
	let variables = $state<Array<{ key: string; label: string; defaultValue?: string }>>([]);
	let styling = $state<{
		primaryColor?: string;
		secondaryColor?: string;
		fontFamily?: string;
		fontSize?: string;
		header?: { content: string; height?: number };
		footer?: { content: string; height?: number };
	} | null>(null);
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
			const result = await createDocumentTemplate({
				name,
				description: description || undefined,
				type,
				content,
				variables: variables.length > 0 ? variables : undefined,
				styling: styling || undefined
			});

			if (result.success) {
				goto(`/${tenantSlug}/document-templates`);
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to create template';
		} finally {
			loading = false;
		}
	}
</script>

<div class="space-y-6">
	<h1 class="text-3xl font-bold">New Document Template</h1>

	<Card>
		<CardHeader>
			<CardTitle>Template Information</CardTitle>
			<CardDescription>Create a new document template with variables and styling</CardDescription>
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
					<Button type="submit" disabled={loading}>
						{loading ? 'Creating...' : 'Create Template'}
					</Button>
				</div>
			</form>
		</CardContent>
	</Card>
</div>
