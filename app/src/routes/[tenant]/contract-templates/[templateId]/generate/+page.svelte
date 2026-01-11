<script lang="ts">
	import { getContractTemplate, generateContractFromTemplate } from '$lib/remotes/contract-templates.remote';
	import { getClients } from '$lib/remotes/clients.remote';
	import { getProjects } from '$lib/remotes/projects.remote';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import { Select, SelectContent, SelectItem, SelectTrigger } from '$lib/components/ui/select';
	import Combobox from '$lib/components/ui/combobox/combobox.svelte';

	const tenantSlug = $derived(page.params.tenant);
	const templateId = $derived(page.params.templateId);

	const templateQuery = getContractTemplate(templateId);
	const template = $derived(templateQuery.current);
	const clientsQuery = getClients();
	const clients = $derived(clientsQuery.current || []);
	const projectsQuery = getProjects();
	const projects = $derived(projectsQuery.current || []);

	const clientOptions = $derived(clients.map((c) => ({ value: c.id, label: c.name })));
	const projectOptions = $derived([
		{ value: '', label: 'None' },
		...projects.map((p) => ({ value: p.id, label: p.name }))
	]);

	let clientId = $state('');
	let projectId = $state('');
	let loading = $state(false);
	let error = $state<string | null>(null);

	async function handleGenerate() {
		if (!clientId) {
			error = 'Please select a client';
			return;
		}

		loading = true;
		error = null;

		try {
			const result = await generateContractFromTemplate({
				templateId,
				clientId,
				projectId: projectId || undefined,
				variables: {}
			});

			if (result.success) {
				goto(`/${tenantSlug}/documents`);
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to generate contract';
		} finally {
			loading = false;
		}
	}
</script>

<div class="space-y-6">
	<h1 class="text-3xl font-bold">Generate Contract</h1>

	{#if template}
		<Card>
			<CardHeader>
				<CardTitle>Generate from Template: {template.name}</CardTitle>
				<CardDescription>Select client and project to generate the contract</CardDescription>
			</CardHeader>
			<CardContent>
				<form
					onsubmit={(e) => {
						e.preventDefault();
						handleGenerate();
					}}
					class="space-y-4"
				>
					<div class="space-y-2">
						<Label for="clientId">Client *</Label>
						<Combobox
							bind:value={clientId}
							options={clientOptions}
							placeholder="Select a client"
							searchPlaceholder="Search clients..."
						/>
					</div>
					<div class="space-y-2">
						<Label for="projectId">Project</Label>
						<Combobox
							bind:value={projectId}
							options={projectOptions}
							placeholder="Select a project (optional)"
							searchPlaceholder="Search projects..."
						/>
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
							{loading ? 'Generating...' : 'Generate Contract'}
						</Button>
					</div>
				</form>
			</CardContent>
		</Card>
	{/if}
</div>
