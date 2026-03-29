<script lang="ts">
	import { getProjects, createProject, deleteProject, updateProject, getProject } from '$lib/remotes/projects.remote';
	import { getClients } from '$lib/remotes/clients.remote';
	import { getInvoiceSettings } from '$lib/remotes/invoice-settings.remote';
	import { formatAmount, CURRENCIES, CURRENCY_LABELS, type Currency } from '$lib/utils/currency';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Card } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Progress } from '$lib/components/ui/progress/index';
	import {
		Dialog,
		DialogContent,
		DialogDescription,
		DialogFooter,
		DialogHeader,
		DialogTitle,
		DialogTrigger
	} from '$lib/components/ui/dialog';
	import {
		DropdownMenu,
		DropdownMenuContent,
		DropdownMenuItem,
		DropdownMenuTrigger
	} from '$lib/components/ui/dropdown-menu';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Select, SelectContent, SelectItem, SelectTrigger } from '$lib/components/ui/select';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import DollarSignIcon from '@lucide/svelte/icons/dollar-sign';
	import MoreVerticalIcon from '@lucide/svelte/icons/more-vertical';
	import type { Project } from '$lib/server/db/schema';
	import { Combobox } from '$lib/components/ui/combobox';

	const tenantSlug = $derived(page.params.tenant);

	const projectsQuery = getProjects(undefined);
	const projects = $derived(projectsQuery.current || []);
	const loading = $derived(projectsQuery.loading);
	const error = $derived(projectsQuery.error);

	const clientsQuery = getClients();
	const clients = $derived(clientsQuery.current || []);

	const invoiceSettingsQuery = getInvoiceSettings();
	const invoiceSettings = $derived(invoiceSettingsQuery.current);

	// Create a map of client IDs to names
	const clientMap = $derived(
		new Map(clients.map((client) => [client.id, client.name]))
	);
	const clientOptions = $derived(clients.map((c) => ({ value: c.id, label: c.name })));

	let isDialogOpen = $state(false);
	let isEditDialogOpen = $state(false);
	let editingProject = $state<Project | null>(null);
	let formName = $state('');
	let formDescription = $state('');
	let formClientId = $state('');
	let formBudget = $state('');
	let formCurrency = $state<Currency>('RON');
	let formStartDate = $state('');
	let formEndDate = $state('');
	let formStatus = $state('planning');
	let formLoading = $state(false);
	let formError = $state<string | null>(null);

	// Update currency when settings load
	$effect(() => {
		if (invoiceSettings?.defaultCurrency) {
			formCurrency = invoiceSettings.defaultCurrency as Currency;
		}
	});

	function getStatusColor(status: string) {
		switch (status) {
			case 'active':
				return 'default';
			case 'completed':
				return 'secondary';
			case 'planning':
				return 'outline';
			case 'on-hold':
				return 'destructive';
			default:
				return 'secondary';
		}
	}

	function formatStatus(status: string) {
		switch (status) {
			case 'active':
				return 'in-progress';
			case 'completed':
				return 'completed';
			case 'planning':
				return 'planning';
			case 'on-hold':
				return 'on-hold';
			default:
				return status;
		}
	}

	function openEditDialog(project: Project) {
		editingProject = project;
		formName = project.name;
		formDescription = project.description || '';
		formClientId = project.clientId || '';
		formBudget = project.budget ? (project.budget / 100).toString() : '';
		formCurrency = (project.currency || invoiceSettings?.defaultCurrency || 'RON') as Currency;
		formStartDate = project.startDate ? new Date(project.startDate).toISOString().split('T')[0] : '';
		formEndDate = project.endDate ? new Date(project.endDate).toISOString().split('T')[0] : '';
		formStatus = project.status || 'planning';
		isEditDialogOpen = true;
	}

	function closeEditDialog() {
		isEditDialogOpen = false;
		editingProject = null;
		formName = '';
		formDescription = '';
		formClientId = '';
		formBudget = '';
		formCurrency = (invoiceSettings?.defaultCurrency || 'RON') as Currency;
		formStartDate = '';
		formEndDate = '';
		formStatus = 'planning';
		formError = null;
	}

	$effect(() => {
		if (!isEditDialogOpen && editingProject) {
			editingProject = null;
		}
	});

	// Calculate progress based on status (simple approach)
	// In a real app, this would be based on completed tasks
	function calculateProgress(status: string): number {
		switch (status) {
			case 'completed':
				return 100;
			case 'active':
				return 50;
			case 'planning':
				return 25;
			case 'on-hold':
				return 0;
			default:
				return 0;
		}
	}

	async function handleCreateProject() {
		formLoading = true;
		formError = null;

		try {
			await createProject({
				name: formName,
				description: formDescription || undefined,
				clientId: formClientId || undefined,
				status: formStatus || undefined,
				startDate: formStartDate || undefined,
				endDate: formEndDate || undefined,
				budget: formBudget ? parseFloat(formBudget) : undefined,
				currency: formCurrency || undefined
			}).updates(projectsQuery);

			// Reset form
			formName = '';
			formDescription = '';
			formClientId = '';
			formBudget = '';
			formStartDate = '';
			formEndDate = '';
			formStatus = 'planning';
			isDialogOpen = false;
		} catch (e) {
			formError = e instanceof Error ? e.message : 'Failed to create project';
		} finally {
			formLoading = false;
		}
	}

	async function handleUpdateProject() {
		if (!editingProject) {
			formError = 'No project selected';
			return;
		}

		formLoading = true;
		formError = null;

		try {
			await updateProject({
				projectId: editingProject.id,
				name: formName,
				description: formDescription || undefined,
				clientId: formClientId || undefined,
				status: formStatus || undefined,
				startDate: formStartDate || undefined,
				endDate: formEndDate || undefined,
				budget: formBudget ? parseFloat(formBudget) : undefined,
				currency: formCurrency || undefined
			}).updates(projectsQuery, getProjects(undefined));

			closeEditDialog();
		} catch (e) {
			formError = e instanceof Error ? e.message : 'Failed to update project';
		} finally {
			formLoading = false;
		}
	}

	async function handleDeleteProject(projectId: string) {
		if (!confirm('Are you sure you want to delete this project?')) {
			return;
		}

		try {
			await deleteProject(projectId).updates(projectsQuery);
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Failed to delete project');
		}
	}
</script>

<svelte:head>
	<title>Projects - CRM</title>
</svelte:head>

<div class="mb-8 flex items-center justify-between">
	<div>
		<h1 class="text-3xl font-bold tracking-tight">Projects</h1>
		<p class="text-muted-foreground mt-1">Track and manage your ongoing projects</p>
	</div>
	<div class="flex gap-2">
		<Dialog bind:open={isDialogOpen}>
			<DialogTrigger>
				{#snippet child({ props })}
					<Button {...props} onclick={() => (isDialogOpen = true)}>
						<PlusIcon class="mr-2 h-4 w-4" />
						New Project
					</Button>
				{/snippet}
			</DialogTrigger>
			<DialogContent class="sm:max-w-[600px] max-h-[85vh] overflow-y-auto">
				<DialogHeader>
					<DialogTitle>Create New Project</DialogTitle>
					<DialogDescription>Start a new project (client is optional for internal projects)</DialogDescription>
				</DialogHeader>
				<div class="grid gap-4 py-4">
					<div class="grid gap-2">
						<Label for="name">Project Name</Label>
						<Input id="name" bind:value={formName} placeholder="Website Redesign" />
					</div>
					<div class="grid gap-2">
						<Label for="description">Description</Label>
						<Textarea id="description" bind:value={formDescription} placeholder="Project description..." />
					</div>
				<div class="grid gap-2">
					<Label for="client">Client</Label>
					<Combobox
						bind:value={formClientId}
						options={clientOptions}
						placeholder="Select a client"
						searchPlaceholder="Search clients..."
					/>
				</div>
					<div class="grid grid-cols-2 gap-4">
						<div class="grid gap-2">
							<Label for="budget">Budget</Label>
							<Input id="budget" type="number" bind:value={formBudget} placeholder="45000" step="0.01" />
						</div>
						<div class="grid gap-2">
							<Label for="currency">Currency</Label>
							<Select type="single" bind:value={formCurrency}>
								<SelectTrigger id="currency">
									{CURRENCY_LABELS[formCurrency]}
								</SelectTrigger>
								<SelectContent>
									{#each CURRENCIES as curr}
										<SelectItem value={curr}>{CURRENCY_LABELS[curr]}</SelectItem>
									{/each}
								</SelectContent>
							</Select>
						</div>
					</div>
					<div class="grid grid-cols-2 gap-4">
						<div class="grid gap-2">
							<Label for="startDate">Start Date</Label>
							<Input id="startDate" type="date" bind:value={formStartDate} />
						</div>
						<div class="grid gap-2">
							<Label for="endDate">End Date</Label>
							<Input id="endDate" type="date" bind:value={formEndDate} />
						</div>
					</div>
					<div class="grid gap-2">
						<Label for="status">Status</Label>
						<Select type="single" bind:value={formStatus}>
							<SelectTrigger id="status">
								{#if formStatus === 'planning'}
									Planning
								{:else if formStatus === 'active'}
									In Progress
								{:else if formStatus === 'on-hold'}
									On Hold
								{:else if formStatus === 'completed'}
									Completed
								{:else}
									Select status
								{/if}
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="planning">Planning</SelectItem>
								<SelectItem value="active">In Progress</SelectItem>
								<SelectItem value="on-hold">On Hold</SelectItem>
								<SelectItem value="completed">Completed</SelectItem>
							</SelectContent>
						</Select>
					</div>
				</div>
				{#if formError}
					<div class="rounded-md bg-red-50 p-3">
						<p class="text-sm text-red-800">{formError}</p>
					</div>
				{/if}
				<DialogFooter>
					<Button variant="outline" onclick={() => (isDialogOpen = false)}>Cancel</Button>
					<Button onclick={handleCreateProject} disabled={formLoading}>
						{formLoading ? 'Creating...' : 'Create Project'}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	</div>
</div>

{#if editingProject}
	<Dialog bind:open={isEditDialogOpen}>
		<DialogContent class="sm:max-w-[600px] max-h-[85vh] overflow-y-auto">
			<DialogHeader>
				<DialogTitle>Edit Project</DialogTitle>
				<DialogDescription>Update project details</DialogDescription>
			</DialogHeader>
			<div class="grid gap-4 py-4">
				<div class="grid gap-2">
					<Label for="edit-name">Project Name</Label>
					<Input id="edit-name" bind:value={formName} placeholder="Website Redesign" />
				</div>
				<div class="grid gap-2">
					<Label for="edit-description">Description</Label>
					<Textarea id="edit-description" bind:value={formDescription} placeholder="Project description..." />
				</div>
				<div class="grid gap-2">
					<Label for="edit-client">Client</Label>
					<Combobox
						bind:value={formClientId}
						options={clientOptions}
						placeholder="Select a client"
						searchPlaceholder="Search clients..."
					/>
				</div>
				<div class="grid grid-cols-2 gap-4">
					<div class="grid gap-2">
						<Label for="edit-budget">Budget</Label>
						<Input id="edit-budget" type="number" bind:value={formBudget} placeholder="45000" step="0.01" />
					</div>
					<div class="grid gap-2">
						<Label for="edit-currency">Currency</Label>
						<Select type="single" bind:value={formCurrency}>
							<SelectTrigger id="edit-currency">
								{CURRENCY_LABELS[formCurrency]}
							</SelectTrigger>
							<SelectContent>
								{#each CURRENCIES as curr}
									<SelectItem value={curr}>{CURRENCY_LABELS[curr]}</SelectItem>
								{/each}
							</SelectContent>
						</Select>
					</div>
				</div>
				<div class="grid grid-cols-2 gap-4">
					<div class="grid gap-2">
						<Label for="edit-startDate">Start Date</Label>
						<Input id="edit-startDate" type="date" bind:value={formStartDate} />
					</div>
					<div class="grid gap-2">
						<Label for="edit-endDate">End Date</Label>
						<Input id="edit-endDate" type="date" bind:value={formEndDate} />
					</div>
				</div>
				<div class="grid gap-2">
					<Label for="edit-status">Status</Label>
					<Select type="single" bind:value={formStatus}>
						<SelectTrigger id="edit-status">
							{#if formStatus === 'planning'}
								Planning
							{:else if formStatus === 'active'}
								In Progress
							{:else if formStatus === 'on-hold'}
								On Hold
							{:else if formStatus === 'completed'}
								Completed
							{:else}
								Select status
							{/if}
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="planning">Planning</SelectItem>
							<SelectItem value="active">In Progress</SelectItem>
							<SelectItem value="on-hold">On Hold</SelectItem>
							<SelectItem value="completed">Completed</SelectItem>
						</SelectContent>
					</Select>
				</div>
			</div>
			{#if formError}
				<div class="rounded-md bg-red-50 p-3">
					<p class="text-sm text-red-800">{formError}</p>
				</div>
			{/if}
			<DialogFooter>
				<Button variant="outline" onclick={closeEditDialog}>Cancel</Button>
				<Button onclick={handleUpdateProject} disabled={formLoading}>
					{formLoading ? 'Saving...' : 'Save Changes'}
				</Button>
			</DialogFooter>
		</DialogContent>
	</Dialog>
{/if}

{#if loading}
	<p>Loading projects...</p>
{:else if error}
	<div class="rounded-md bg-red-50 p-3">
		<p class="text-sm text-red-800">
			{error instanceof Error ? error.message : 'Failed to load projects'}
		</p>
	</div>
{:else if projects.length === 0}
	<Card>
		<div class="p-6 text-center">
			<p class="text-muted-foreground">No projects yet. Get started by creating your first project.</p>
		</div>
	</Card>
{:else}
	<div class="grid gap-6 md:grid-cols-2">
		{#each projects as project}
			{@const clientName = project.clientId ? (clientMap.get(project.clientId) || 'Unknown Client') : 'Internal Project'}
			{@const progress = calculateProgress(project.status)}
			{@const projectCurrency = (project.currency || 'RON') as Currency}
			{@const formattedEndDate = project.endDate ? new Date(project.endDate).toLocaleDateString() : 'No date'}
			<Card class="p-6">
				<div class="flex items-start justify-between mb-4">
					<div class="flex-1">
						<div class="flex items-center gap-3 mb-2">
							<a
								href="/{tenantSlug}/projects/{project.id}"
								class="text-xl font-semibold hover:text-primary cursor-pointer"
							>
								{project.name}
							</a>
							<Badge variant={getStatusColor(project.status)}>{formatStatus(project.status)}</Badge>
						</div>
						{#if project.clientId}
							<a
								href="/{tenantSlug}/clients/{project.clientId}"
								class="text-sm text-muted-foreground hover:text-primary cursor-pointer"
							>
								{clientName}
							</a>
						{:else}
							<span class="text-sm text-muted-foreground">
								{clientName}
							</span>
						{/if}
					</div>
					<DropdownMenu>
						<DropdownMenuTrigger>
							{#snippet child({ props })}
								<Button {...props} variant="ghost" size="icon">
									<MoreVerticalIcon class="h-4 w-4" />
								</Button>
							{/snippet}
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
							<DropdownMenuItem onclick={() => openEditDialog(project)}>Edit</DropdownMenuItem>
							<DropdownMenuItem onclick={() => goto(`/${tenantSlug}/projects/${project.id}`)}>
								View Details
							</DropdownMenuItem>
							<DropdownMenuItem onclick={() => goto(`/${tenantSlug}/projects/${project.id}/tasks`)}>
								Manage Tasks
							</DropdownMenuItem>
							<DropdownMenuItem class="text-destructive" onclick={() => handleDeleteProject(project.id)}>
								Delete
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</div>

				<div class="space-y-4">
					<div>
						<div class="flex items-center justify-between mb-2">
							<span class="text-sm font-medium">Progress</span>
							<span class="text-sm font-semibold text-primary">{progress}%</span>
						</div>
						<Progress value={progress} class="h-2" />
					</div>

					<div class="grid grid-cols-2 gap-4 pt-2">
						<div class="flex items-center gap-3">
							<div class="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
								<DollarSignIcon class="h-5 w-5 text-primary" />
							</div>
							<div>
								<p class="text-xs text-muted-foreground">Budget</p>
								<p class="text-sm font-semibold">
									{project.budget ? formatAmount(project.budget, projectCurrency) : '—'}
								</p>
							</div>
						</div>

						<div class="flex items-center gap-3">
							<div class="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
								<CalendarIcon class="h-5 w-5 text-blue-600" />
							</div>
							<div>
								<p class="text-xs text-muted-foreground">Due Date</p>
								<p class="text-sm font-medium">{formattedEndDate}</p>
							</div>
						</div>
					</div>
				</div>
			</Card>
		{/each}
	</div>
{/if}
