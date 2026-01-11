<script lang="ts">
	import { getClients } from '$lib/remotes/clients.remote';
	import { createProject } from '$lib/remotes/projects.remote';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Select, SelectContent, SelectItem, SelectTrigger } from '$lib/components/ui/select';
	import Combobox from '$lib/components/ui/combobox/combobox.svelte';
	import { FormSection } from '$lib/components/app/form-section';
	import { Progress } from '$lib/components/ui/progress/index';

	const tenantSlug = $derived(page.params.tenant);
	const clientsQuery = getClients();
	const clients = $derived(clientsQuery.current || []);

	const clientOptions = $derived(clients.map((c) => ({ value: c.id, label: c.name })));

	let name = $state('');
	let description = $state('');
	let clientId = $state('');
	let status = $state('planning');
	let startDate = $state('');
	let endDate = $state('');
	let budget = $state('');
	let loading = $state(false);
	let error = $state<string | null>(null);

	// Section completion states
	let basicInfoCompleted = $derived(!!name);
	let detailsCompleted = $derived(!!(status || startDate || endDate || budget));

	const completedSections = $derived((basicInfoCompleted ? 1 : 0) + (detailsCompleted ? 1 : 0));
	const totalSections = 2;
	const progress = $derived((completedSections / totalSections) * 100);

	async function handleSubmit() {
		loading = true;
		error = null;

		try {
			const result = await createProject({
				name,
				description: description || undefined,
				clientId: clientId || undefined,
				status: status || undefined,
				startDate: startDate || undefined,
				endDate: endDate || undefined,
				budget: budget ? parseFloat(budget) : undefined
			});

			if (result.success) {
				goto(`/${tenantSlug}/projects`);
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to create project';
		} finally {
			loading = false;
		}
	}
</script>

<div class="space-y-6">
	<h1 class="text-3xl font-bold">New Project</h1>

	<Card>
		<CardHeader>
			<CardTitle>Project Information</CardTitle>
			<CardDescription>Create a new project</CardDescription>
			<div class="mt-4 space-y-2">
				<div class="flex items-center justify-between text-sm">
					<span class="text-muted-foreground">Progress</span>
					<span class="font-medium">{completedSections} of {totalSections} sections completed</span>
				</div>
				<Progress value={progress} class="h-2" />
			</div>
		</CardHeader>
		<CardContent>
			<form
				onsubmit={(e) => {
					e.preventDefault();
					handleSubmit();
				}}
				class="space-y-4"
			>
				<FormSection
					title="Basic Information"
					description="Project details (client is optional for internal projects)"
					bind:completed={basicInfoCompleted}
					defaultOpen={true}
				>
					<div class="space-y-4">
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
					</div>
				</FormSection>

				<FormSection
					title="Project Details"
					description="Status, dates, and budget"
					bind:completed={detailsCompleted}
					defaultOpen={false}
				>
					<div class="space-y-4">
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
						<div class="space-y-2">
							<Label for="budget">Budget (€)</Label>
							<Input id="budget" bind:value={budget} type="number" step="0.01" />
						</div>
					</div>
				</FormSection>

				{#if error}
					<div class="rounded-md bg-red-50 p-3">
						<p class="text-sm text-red-800">{error}</p>
					</div>
				{/if}

				<div class="flex items-center justify-end gap-4">
					<Button type="button" variant="outline" onclick={() => goto(`/${tenantSlug}/projects`)}>
						Cancel
					</Button>
					<Button type="submit" disabled={loading}>
						{loading ? 'Creating...' : 'Create Project'}
					</Button>
				</div>
			</form>
		</CardContent>
	</Card>
</div>
