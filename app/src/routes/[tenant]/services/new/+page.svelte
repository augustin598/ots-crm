<script lang="ts">
	import { getClients } from '$lib/remotes/clients.remote';
	import { getProjects } from '$lib/remotes/projects.remote';
	import { createService } from '$lib/remotes/services.remote';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Select, SelectContent, SelectItem, SelectTrigger } from '$lib/components/ui/select';
	import { FormSection } from '$lib/components/app/form-section';
	import { Progress } from '$lib/components/ui/progress/index';

	const tenantSlug = $derived(page.params.tenant);
	const clientsQuery = getClients();
	const clients = $derived(clientsQuery.current || []);
	const projectsQuery = getProjects(undefined);
	const projects = $derived(projectsQuery.current || []);

	let name = $state('');
	let description = $state('');
	let clientId = $state('');
	let projectId = $state('');
	let price = $state('');
	let recurringType = $state('none');
	let recurringInterval = $state('1');
	let isActive = $state(true);
	let loading = $state(false);
	let error = $state<string | null>(null);

	// Section completion states
	let basicInfoCompleted = $derived(!!(name && clientId));
	let pricingCompleted = $derived(!!(price || recurringType !== 'none'));

	const completedSections = $derived((basicInfoCompleted ? 1 : 0) + (pricingCompleted ? 1 : 0));
	const totalSections = 2;
	const progress = $derived((completedSections / totalSections) * 100);

	async function handleSubmit() {
		if (!name || !clientId) {
			error = 'Name and client are required';
			return;
		}

		loading = true;
		error = null;

		try {
			const result = await createService({
				name,
				description: description || undefined,
				clientId,
				projectId: projectId || undefined,
				price: price ? parseFloat(price) : undefined,
				recurringType: recurringType || undefined,
				recurringInterval: parseInt(recurringInterval) || undefined,
				isActive: isActive
			});

			if (result.success) {
				goto(`/${tenantSlug}/services`);
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to create service';
		} finally {
			loading = false;
		}
	}
</script>

<div class="space-y-6">
	<h1 class="text-3xl font-bold">New Service</h1>

	<Card>
		<CardHeader>
			<CardTitle>Service Information</CardTitle>
			<CardDescription>Create a new service</CardDescription>
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
					description="Service name, client, and description"
					bind:completed={basicInfoCompleted}
					defaultOpen={true}
				>
					<div class="space-y-4">
						<div class="space-y-2">
							<Label for="clientId">Client *</Label>
							<Select type="single" bind:value={clientId} required>
								<SelectTrigger>
									{#if clientId}
										{clients.find((c) => c.id === clientId)?.name || 'Select a client'}
									{:else}
										Select a client
									{/if}
								</SelectTrigger>
								<SelectContent>
									{#each clients as client}
										<SelectItem value={client.id}>{client.name}</SelectItem>
									{/each}
								</SelectContent>
							</Select>
						</div>
						<div class="space-y-2">
							<Label for="projectId">Project</Label>
							<Select type="single" bind:value={projectId}>
								<SelectTrigger>
									{#if projectId}
										{projects.find((p) => p.id === projectId)?.name || 'Select a project'}
									{:else}
										Select a project (optional)
									{/if}
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="">None</SelectItem>
									{#each projects as project}
										<SelectItem value={project.id}>{project.name}</SelectItem>
									{/each}
								</SelectContent>
							</Select>
						</div>
						<div class="space-y-2">
							<Label for="name">Service Name *</Label>
							<Input id="name" bind:value={name} type="text" required />
						</div>
						<div class="space-y-2">
							<Label for="description">Description</Label>
							<Textarea id="description" bind:value={description} />
						</div>
					</div>
				</FormSection>

				<FormSection
					title="Pricing & Recurring"
					description="Service pricing and billing frequency"
					bind:completed={pricingCompleted}
					defaultOpen={false}
				>
					<div class="space-y-4">
						<div class="space-y-2">
							<Label for="price">Price (€)</Label>
							<Input id="price" bind:value={price} type="number" step="0.01" />
						</div>
						<div class="grid grid-cols-2 gap-4">
							<div class="space-y-2">
								<Label for="recurringType">Recurring Type</Label>
								<Select type="single" bind:value={recurringType}>
									<SelectTrigger>
										{#if recurringType === 'none'}
											One-time
										{:else if recurringType === 'daily'}
											Daily
										{:else if recurringType === 'weekly'}
											Weekly
										{:else if recurringType === 'monthly'}
											Monthly
										{:else if recurringType === 'yearly'}
											Yearly
										{:else}
											Select type
										{/if}
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="none">One-time</SelectItem>
										<SelectItem value="daily">Daily</SelectItem>
										<SelectItem value="weekly">Weekly</SelectItem>
										<SelectItem value="monthly">Monthly</SelectItem>
										<SelectItem value="yearly">Yearly</SelectItem>
									</SelectContent>
								</Select>
							</div>
							<div class="space-y-2">
								<Label for="recurringInterval">Recurring Interval</Label>
								<Input id="recurringInterval" bind:value={recurringInterval} type="number" min="1" />
							</div>
						</div>
					</div>
				</FormSection>

				{#if error}
					<div class="rounded-md bg-red-50 p-3">
						<p class="text-sm text-red-800">{error}</p>
					</div>
				{/if}

				<div class="flex items-center justify-end gap-4">
					<Button type="button" variant="outline" onclick={() => goto(`/${tenantSlug}/services`)}>
						Cancel
					</Button>
					<Button type="submit" disabled={loading}>
						{loading ? 'Creating...' : 'Create Service'}
					</Button>
				</div>
			</form>
		</CardContent>
	</Card>
</div>
