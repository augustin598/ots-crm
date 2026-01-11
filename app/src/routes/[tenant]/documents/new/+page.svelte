<script lang="ts">
	import { getDocumentTemplates, getDocumentTemplate } from '$lib/remotes/document-templates.remote';
	import { getClients } from '$lib/remotes/clients.remote';
	import { getProjects } from '$lib/remotes/projects.remote';
	import { generateDocumentFromTemplate } from '$lib/remotes/documents.remote';
	import { resolveStandardVariables } from '$lib/utils/document-variables';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import { Select, SelectContent, SelectItem, SelectTrigger } from '$lib/components/ui/select';
	import Combobox from '$lib/components/ui/combobox/combobox.svelte';
	import { Card, CardContent } from '$lib/components/ui/card';
	import VariableInputs from '$lib/components/variable-inputs.svelte';
	import DocumentPreviewEditor from '$lib/components/document-preview-editor.svelte';
	import type { VariableMap } from '$lib/utils/document-variables';
	import { Save, FileText } from '@lucide/svelte';

	const tenantSlug = $derived(page.params.tenant);

	// Get tenant data from layout
	let { data }: { data: { tenant?: any } } = $props();
	const tenant = $derived(data?.tenant);

	// Get template type filter and client from URL
	let templateTypeFilter = $state<string | undefined>(undefined);
	
	// Check URL params for type and clientId
	$effect(() => {
		const urlParams = new URLSearchParams(page.url.search);
		const type = urlParams.get('type');
		const clientIdParam = urlParams.get('clientId');
		if (type === 'contract') {
			templateTypeFilter = 'contract';
		}
		if (clientIdParam && !selectedClientId) {
			selectedClientId = clientIdParam;
		}
	});

	// Fetch data
	const templatesQuery = getDocumentTemplates({ type: templateTypeFilter });
	const templates = $derived(templatesQuery.current || []);

	const clientsQuery = getClients();
	const clients = $derived(clientsQuery.current || []);

	const projectsQuery = getProjects(undefined);
	const projects = $derived(projectsQuery.current || []);

	const clientOptions = $derived(clients.map((c) => ({ value: c.id, label: c.name })));

	// State
	let selectedTemplateId = $state<string>('');
	let selectedClientId = $state<string>('');
	let selectedProjectId = $state<string>('');
	let customVariableValues = $state<Record<string, string>>({});
	let editedContent = $state<string | null>(null);
	let loading = $state(false);
	let error = $state<string | null>(null);

	// Get selected template
	const templateQuery = $derived(
		selectedTemplateId ? getDocumentTemplate(selectedTemplateId) : null
	);
	const template = $derived(templateQuery?.current);

	// Get selected client and project
	const selectedClient = $derived(clients.find((c) => c.id === selectedClientId));
	const selectedProject = $derived(
		selectedProjectId ? projects.find((p) => p.id === selectedProjectId) : null
	);

	// Filter projects by client
	const availableProjects = $derived(
		selectedClientId ? projects.filter((p) => p.clientId === selectedClientId) : []
	);
	const projectOptions = $derived(
		availableProjects.map((p) => ({ value: p.id, label: p.name }))
	);

	// Resolve variables
	const standardVariables = $derived(() => {
		if (!tenant || !selectedClient) return {};
		return resolveStandardVariables(tenant, selectedClient, selectedProject || null, customVariableValues);
	});

	const allVariables = $derived.by(() => {
		return { ...standardVariables(), ...customVariableValues };
	});

	// Reset project when client changes
	let previousClientId = $state('');
	$effect(() => {
		if (previousClientId && previousClientId !== selectedClientId) {
			selectedProjectId = '';
		}
		previousClientId = selectedClientId;
	});
	$effect(() => {
		if (selectedClientId && !availableProjects.find((p) => p.id === selectedProjectId)) {
			selectedProjectId = '';
		}
	});

	async function handleGenerate() {
		if (!selectedTemplateId || !selectedClientId) {
			error = 'Please select a template and client';
			return;
		}

		loading = true;
		error = null;

		try {
			const result = await generateDocumentFromTemplate({
				templateId: selectedTemplateId,
				clientId: selectedClientId,
				projectId: selectedProjectId || undefined,
				variables: customVariableValues,
				editedContent: editedContent || undefined
			});

			if (result.success) {
				goto(`/${tenantSlug}/documents`);
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to generate document';
		} finally {
			loading = false;
		}
	}

	function handleCustomValueChange(key: string, value: string) {
		customVariableValues = { ...customVariableValues, [key]: value };
	}

	function handleContentEdit(content: string) {
		editedContent = content;
	}
</script>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h1 class="text-3xl font-bold">Create Document</h1>
	</div>

	{#if error}
		<div class="rounded-md bg-red-50 p-3">
			<p class="text-sm text-red-800">{error}</p>
		</div>
	{/if}

	<div class="grid grid-cols-1 lg:grid-cols-[40%_60%] gap-6">
		<!-- Left Panel -->
		<div class="space-y-4">
			<Card>
				<CardContent class="pt-6 space-y-4">
					<div class="space-y-2">
						<Label for="template">Template *</Label>
						<Select
							value={selectedTemplateId}
							type="single"
							onValueChange={(value) => {
								selectedTemplateId = value || '';
								editedContent = null;
							}}
						>
							<SelectTrigger id="template">
								{#if selectedTemplateId}
									{templates.find((t) => t.id === selectedTemplateId)?.name || 'Select a template'}
								{:else}
									Select a template
								{/if}
							</SelectTrigger>
							<SelectContent>
								{#each templates as t}
									<SelectItem value={t.id}>{t.name}</SelectItem>
								{/each}
							</SelectContent>
						</Select>
					</div>

					<div class="space-y-2">
						<Label for="client">Client *</Label>
						<Combobox
							bind:value={selectedClientId}
							options={clientOptions}
							placeholder="Select a client"
							searchPlaceholder="Search clients..."
						/>
					</div>

					{#if availableProjects.length > 0}
						<div class="space-y-2">
							<Label for="project">Project (Optional)</Label>
							<Combobox
								bind:value={selectedProjectId}
								options={projectOptions}
								placeholder="Select a project (optional)"
								searchPlaceholder="Search projects..."
							/>
						</div>
					{/if}
				</CardContent>
			</Card>

			{#if template && selectedClient}
				<VariableInputs
					standardVariables={standardVariables()}
					customVariables={(template.variables as Array<{ key: string; label: string }>) || []}
					customValues={customVariableValues}
					onCustomValueChange={handleCustomValueChange}
				/>

				<div class="flex gap-2">
					<Button variant="outline" onclick={() => goto(`/${tenantSlug}/documents`)}>
						Cancel
					</Button>
					<Button onclick={handleGenerate} disabled={loading}>
						<FileText class="mr-2 h-4 w-4" />
						{loading ? 'Generating...' : 'Generate Document'}
					</Button>
				</div>
			{/if}
		</div>

		<!-- Right Panel - Preview -->
		<div class="h-[calc(100vh-200px)]">
			{#if template && selectedClient}
				<DocumentPreviewEditor
					template={template}
					variables={allVariables}
					editedContent={editedContent}
					onContentEdit={handleContentEdit}
				/>
			{:else}
				<Card class="h-full flex items-center justify-center">
					<CardContent>
						<p class="text-muted-foreground text-center">
							Select a template and client to see preview
						</p>
					</CardContent>
				</Card>
			{/if}
		</div>
	</div>
</div>
