<script lang="ts">
	import { getProject, updateProject, getProjects } from '$lib/remotes/projects.remote';
	import { getClients } from '$lib/remotes/clients.remote';
	import { getInvoiceSettings } from '$lib/remotes/invoice-settings.remote';
	import { CURRENCIES, type Currency } from '$lib/utils/currency';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Select, SelectContent, SelectItem, SelectTrigger } from '$lib/components/ui/select';
	import Combobox from '$lib/components/ui/combobox/combobox.svelte';

	const tenantSlug = $derived(page.params.tenant);
	const projectId = $derived(page.params.projectId);

	const projectQuery = getProject(projectId);
	const project = $derived(projectQuery.current);
	const clientsQuery = getClients();
	const clients = $derived(clientsQuery.current || []);

	const clientOptions = $derived(clients.map((c) => ({ value: c.id, label: c.name })));

	const invoiceSettingsQuery = getInvoiceSettings();
	const invoiceSettings = $derived(invoiceSettingsQuery.current);

	let name = $state('');
	let description = $state('');
	let clientId = $state('');
	let status = $state('planning');
	let startDate = $state('');
	let endDate = $state('');
	let budget = $state('');
	let currency = $state<Currency>('RON');
	let saving = $state(false);
	let error = $state<string | null>(null);

	$effect(() => {
		if (project) {
			name = project.name || '';
			description = project.description || '';
			clientId = project.clientId || '';
			status = project.status || 'planning';
			startDate = project.startDate ? new Date(project.startDate).toISOString().split('T')[0] : '';
			endDate = project.endDate ? new Date(project.endDate).toISOString().split('T')[0] : '';
			budget = project.budget ? (project.budget / 100).toString() : '';
			currency = (project.currency || invoiceSettings?.defaultCurrency || 'RON') as Currency;
		}
	});

	$effect(() => {
		if (invoiceSettings && !project) {
			currency = (invoiceSettings.defaultCurrency || 'RON') as Currency;
		}
	});

	async function handleSubmit() {
		saving = true;
		error = null;

		try {
			await updateProject({
				projectId: projectId!,
				name,
				description: description || undefined,
				clientId: clientId || undefined,
				status: status || undefined,
				startDate: startDate || undefined,
				endDate: endDate || undefined,
				budget: budget ? parseFloat(budget) : undefined,
				currency: currency || undefined
			}).updates(projectQuery, getProject(projectId!), getProjects(undefined));

			goto(`/${tenantSlug}/projects/${projectId}`);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to update project';
		} finally {
			saving = false;
		}
	}
</script>

<div class="space-y-6">
	{#if project}
		<h1 class="text-3xl font-bold">Edit Project</h1>

		<Card>
			<CardHeader>
				<CardTitle>Project Information</CardTitle>
				<CardDescription>Update project details</CardDescription>
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
						<Label for="clientId">Client</Label>
						<Combobox
							bind:value={clientId}
							options={clientOptions}
							placeholder="Select a client (optional)"
							searchPlaceholder="Search clients..."
						/>
					</div>
					<div class="space-y-2">
						<Label for="name">Project Name *</Label>
						<Input id="name" bind:value={name} type="text" required />
					</div>
					<div class="space-y-2">
						<Label for="description">Description</Label>
						<Textarea id="description" bind:value={description} />
					</div>
					<div class="space-y-2">
						<Label for="status">Status</Label>
						<Select type="single" bind:value={status}>
							<SelectTrigger>
								{#if status === 'planning'}
									Planning
								{:else if status === 'active'}
									Active
								{:else if status === 'on-hold'}
									On Hold
								{:else if status === 'completed'}
									Completed
								{:else if status === 'cancelled'}
									Cancelled
								{:else}
									Select status
								{/if}
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="planning">Planning</SelectItem>
								<SelectItem value="active">Active</SelectItem>
								<SelectItem value="on-hold">On Hold</SelectItem>
								<SelectItem value="completed">Completed</SelectItem>
								<SelectItem value="cancelled">Cancelled</SelectItem>
							</SelectContent>
						</Select>
					</div>
					<div class="grid grid-cols-2 gap-4">
						<div class="space-y-2">
							<Label for="startDate">Start Date</Label>
							<Input id="startDate" bind:value={startDate} type="date" />
						</div>
						<div class="space-y-2">
							<Label for="endDate">End Date</Label>
							<Input id="endDate" bind:value={endDate} type="date" />
						</div>
					</div>
					<div class="grid grid-cols-2 gap-4">
						<div class="grid gap-2">
							<Label for="budget">Budget</Label>
							<Input id="budget" bind:value={budget} type="number" step="0.01" />
						</div>
						<div class="grid gap-2">
							<Label for="currency">Currency</Label>
							<Select type="single" bind:value={currency}>
								<SelectTrigger id="currency">
									{currency}
								</SelectTrigger>
								<SelectContent>
									{#each CURRENCIES as curr}
										<SelectItem value={curr}>{curr}</SelectItem>
									{/each}
								</SelectContent>
							</Select>
						</div>
					</div>

					{#if error}
						<div class="rounded-md bg-red-50 p-3">
							<p class="text-sm text-red-800">{error}</p>
						</div>
					{/if}

					<div class="flex items-center justify-end gap-4">
						<Button type="button" variant="outline" onclick={() => goto(`/${tenantSlug}/projects/${projectId}`)}>
							Cancel
						</Button>
						<Button type="submit" disabled={saving}>
							{saving ? 'Saving...' : 'Save Changes'}
						</Button>
					</div>
				</form>
			</CardContent>
		</Card>
	{/if}
</div>
