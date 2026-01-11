<script lang="ts">
	import { getProject } from '$lib/remotes/projects.remote';
	import { getClient } from '$lib/remotes/clients.remote';
	import { getTasks } from '$lib/remotes/tasks.remote';
	import { getMilestones, createMilestone, updateMilestone, deleteMilestone } from '$lib/remotes/milestones.remote';
	import { formatAmount, type Currency } from '$lib/utils/currency';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Card, CardContent } from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import { Progress } from '$lib/components/ui/progress';
	import { Button } from '$lib/components/ui/button';
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
	import {
		Calendar,
		DollarSign,
		Users,
		CheckCircle2,
		Circle,
		Clock,
		Plus,
		MoreVertical
	} from '@lucide/svelte';
	import type { Milestone } from '$lib/server/db/schema';

	const tenantSlug = $derived(page.params.tenant);
	const projectId = $derived(page.params.projectId);

	const projectQuery = getProject(projectId);
	const project = $derived(projectQuery.current);
	const loading = $derived(projectQuery.loading);

	const clientQuery = $derived(
		project?.clientId ? getClient(project.clientId) : null
	);
	const client = $derived(clientQuery?.current);

	const tasksQuery = getTasks({ projectId });
	const tasks = $derived(tasksQuery.current || []);

	const milestonesQuery = getMilestones(projectId);
	const milestones = $derived(milestonesQuery.current || []);

	// Calculate progress from tasks
	const projectProgress = $derived.by(() => {
		if (tasks.length === 0) return 0;
		const done = tasks.filter((t) => t.status === 'done').length;
		return Math.round((done / tasks.length) * 100);
	});

	// Get tasks for each milestone
	const getTasksForMilestone = (milestoneId: string) => {
		return tasks.filter((t) => t.milestoneId === milestoneId);
	};

	const completedMilestones = $derived.by(() =>
		milestones.filter((m) => m.status === 'completed').length
	);
	const totalMilestones = $derived.by(() => milestones.length);

	// Milestone form state
	let isMilestoneDialogOpen = $state(false);
	let isEditMilestoneDialogOpen = $state(false);
	let editingMilestone = $state<Milestone | null>(null);
	let formName = $state('');
	let formDescription = $state('');
	let formStatus = $state('pending');
	let formDueDate = $state('');
	let formLoading = $state(false);
	let formError = $state<string | null>(null);

	function openEditMilestone(milestone: Milestone) {
		editingMilestone = milestone;
		formName = milestone.name;
		formDescription = milestone.description || '';
		formStatus = milestone.status || 'pending';
		formDueDate = milestone.dueDate ? new Date(milestone.dueDate).toISOString().split('T')[0] : '';
		isEditMilestoneDialogOpen = true;
	}

	function closeEditMilestoneDialog() {
		isEditMilestoneDialogOpen = false;
		editingMilestone = null;
		formName = '';
		formDescription = '';
		formStatus = 'pending';
		formDueDate = '';
		formError = null;
	}

	async function handleCreateMilestone() {
		if (!formName) {
			formError = 'Name is required';
			return;
		}

		formLoading = true;
		formError = null;

		try {
			await createMilestone({
				name: formName,
				description: formDescription || undefined,
				projectId,
				status: formStatus || undefined,
				dueDate: formDueDate || undefined
			}).updates(getMilestones(projectId));

			// Reset form
			formName = '';
			formDescription = '';
			formStatus = 'pending';
			formDueDate = '';
			isMilestoneDialogOpen = false;
		} catch (e) {
			formError = e instanceof Error ? e.message : 'Failed to create milestone';
		} finally {
			formLoading = false;
		}
	}

	async function handleUpdateMilestone() {
		if (!editingMilestone || !formName) {
			formError = 'Name is required';
			return;
		}

		formLoading = true;
		formError = null;

		try {
			await updateMilestone({
				milestoneId: editingMilestone.id,
				name: formName,
				description: formDescription || undefined,
				projectId,
				status: formStatus || undefined,
				dueDate: formDueDate || undefined,
				completedDate: formStatus === 'completed' ? new Date().toISOString() : undefined
			}).updates(getMilestones(projectId));

			closeEditMilestoneDialog();
		} catch (e) {
			formError = e instanceof Error ? e.message : 'Failed to update milestone';
		} finally {
			formLoading = false;
		}
	}

	async function handleDeleteMilestone(milestoneId: string) {
		if (!confirm('Are you sure you want to delete this milestone?')) {
			return;
		}

		try {
			await deleteMilestone(milestoneId).updates(getMilestones(projectId));
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Failed to delete milestone');
		}
	}

	// Extract unique team members from tasks
	type TeamMember = {
		id: string;
		name: string;
	};

	const teamMembers = $derived.by((): TeamMember[] => {
		const userIds = new Set<string>();
		tasks.forEach((task) => {
			if (task.assignedToUserId) {
				userIds.add(task.assignedToUserId);
			}
		});
		return Array.from(userIds).map((userId) => ({
			id: userId,
			name: userId.substring(0, 8) // Show first 8 chars as placeholder
		}));
	});

</script>

<div class="space-y-6">
	{#if loading}
		<p>Loading project...</p>
	{:else if !project}
		<div>Project not found</div>
	{:else}
		<!-- KPI Cards -->
		<div class="grid gap-4 md:grid-cols-4 mb-6">
			<Card class="p-4">
				<div class="flex items-center gap-3">
					<div class="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
						<DollarSign class="h-6 w-6 text-primary" />
					</div>
					<div>
						<p class="text-sm text-muted-foreground">Budget</p>
						<p class="text-2xl font-bold">
							{#if project.budget}
								{formatAmount(project.budget, (project.currency || 'RON') as Currency)}
							{:else}
								—
							{/if}
						</p>
					</div>
				</div>
			</Card>

			<Card class="p-4">
				<div class="flex items-center gap-3">
					<div class="flex h-12 w-12 items-center justify-center rounded-lg bg-blue-500/10">
						<CheckCircle2 class="h-6 w-6 text-blue-600" />
					</div>
					<div>
						<p class="text-sm text-muted-foreground">Progress</p>
						<p class="text-2xl font-bold">{projectProgress}%</p>
					</div>
				</div>
			</Card>

			<Card class="p-4">
				<div class="flex items-center gap-3">
					<div class="flex h-12 w-12 items-center justify-center rounded-lg bg-purple-500/10">
						<Users class="h-6 w-6 text-purple-600" />
					</div>
					<div>
						<p class="text-sm text-muted-foreground">Team Members</p>
						<p class="text-2xl font-bold">{teamMembers.length}</p>
					</div>
				</div>
			</Card>

			<Card class="p-4">
				<div class="flex items-center gap-3">
					<div class="flex h-12 w-12 items-center justify-center rounded-lg bg-green-500/10">
						<Calendar class="h-6 w-6 text-green-600" />
					</div>
					<div>
						<p class="text-sm text-muted-foreground">Due Date</p>
						<p class="text-lg font-bold">
							{#if project.endDate}{new Date(project.endDate).toLocaleDateString()}{:else}—{/if}
						</p>
					</div>
				</div>
			</Card>
		</div>

		<!-- Roadmap Section -->
		<Card class="p-6">
			<div class="flex items-center justify-between mb-6">
				<h3 class="text-lg font-semibold">Project Milestones</h3>
				<div class="flex items-center gap-4">
					<div class="text-sm text-muted-foreground">
						{completedMilestones} of {totalMilestones} completed
					</div>
					<Dialog bind:open={isMilestoneDialogOpen}>
						<DialogTrigger>
							<Button size="sm" onclick={() => (isMilestoneDialogOpen = true)}>
								<Plus class="mr-2 h-4 w-4" />
								New Milestone
							</Button>
						</DialogTrigger>
						<DialogContent class="sm:max-w-[500px]">
							<DialogHeader>
								<DialogTitle>Create New Milestone</DialogTitle>
								<DialogDescription>Add a milestone to track project progress</DialogDescription>
							</DialogHeader>
							<div class="grid gap-4 py-4">
								<div class="grid gap-2">
									<Label for="milestone-name">Milestone Name</Label>
									<Input id="milestone-name" bind:value={formName} placeholder="Phase 1: Planning" />
								</div>
								<div class="grid gap-2">
									<Label for="milestone-description">Description</Label>
									<Textarea
										id="milestone-description"
										bind:value={formDescription}
										placeholder="Milestone description..."
									/>
								</div>
								<div class="grid gap-2">
									<Label for="milestone-status">Status</Label>
									<Select type="single" bind:value={formStatus}>
										<SelectTrigger id="milestone-status">
											{#if formStatus === 'pending'}
												Pending
											{:else if formStatus === 'in-progress'}
												In Progress
											{:else if formStatus === 'completed'}
												Completed
											{:else}
												Select status
											{/if}
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="pending">Pending</SelectItem>
											<SelectItem value="in-progress">In Progress</SelectItem>
											<SelectItem value="completed">Completed</SelectItem>
										</SelectContent>
									</Select>
								</div>
								<div class="grid gap-2">
									<Label for="milestone-due-date">Due Date</Label>
									<Input id="milestone-due-date" type="date" bind:value={formDueDate} />
								</div>
							</div>
							{#if formError}
								<div class="rounded-md bg-red-50 p-3">
									<p class="text-sm text-red-800">{formError}</p>
								</div>
							{/if}
							<DialogFooter>
								<Button variant="outline" onclick={() => (isMilestoneDialogOpen = false)}>Cancel</Button>
								<Button onclick={handleCreateMilestone} disabled={formLoading}>
									{formLoading ? 'Creating...' : 'Create Milestone'}
								</Button>
							</DialogFooter>
						</DialogContent>
					</Dialog>
				</div>
			</div>
			{#if totalMilestones > 0}
				<Progress value={(completedMilestones / totalMilestones) * 100} class="mb-8 h-3" />
			{/if}

			<div class="space-y-6">
				{#each milestones as milestone, index}
					{@const milestoneTasks = getTasksForMilestone(milestone.id)}
					<div class="relative">
						{#if index !== milestones.length - 1}
							<div class="absolute left-6 top-12 h-full w-0.5 bg-border" />
						{/if}
						<div class="flex gap-4">
							<div
								class="flex h-12 w-12 items-center justify-center rounded-full {milestone.status === 'completed'
									? 'bg-primary text-primary-foreground'
									: milestone.status === 'in-progress'
										? 'bg-blue-500 text-white'
										: 'bg-muted text-muted-foreground'}"
							>
								{#if milestone.status === 'completed'}
									<CheckCircle2 class="h-6 w-6" />
								{:else if milestone.status === 'in-progress'}
									<Clock class="h-6 w-6" />
								{:else}
									<Circle class="h-6 w-6" />
								{/if}
							</div>
							<Card class="flex-1 p-4">
								<div class="flex items-start justify-between mb-2">
									<div class="flex-1">
										<h4 class="font-semibold text-lg">{milestone.name}</h4>
										{#if milestone.description}
											<p class="text-sm text-muted-foreground mt-1">{milestone.description}</p>
										{/if}
										{#if milestoneTasks.length > 0}
											<p class="text-xs text-muted-foreground mt-2">
												{milestoneTasks.length} task{milestoneTasks.length === 1 ? '' : 's'} associated
											</p>
										{/if}
									</div>
									<div class="flex items-center gap-2">
										<Badge
											variant={
												milestone.status === 'completed'
													? 'default'
													: milestone.status === 'in-progress'
														? 'secondary'
														: 'outline'
											}
										>
											{milestone.status}
										</Badge>
										<DropdownMenu>
											<DropdownMenuTrigger>
												<Button variant="ghost" size="icon">
													<MoreVertical class="h-4 w-4" />
												</Button>
											</DropdownMenuTrigger>
											<DropdownMenuContent align="end">
												<DropdownMenuItem onclick={() => openEditMilestone(milestone)}>
													Edit
												</DropdownMenuItem>
												<DropdownMenuItem
													class="text-destructive"
													onclick={() => handleDeleteMilestone(milestone.id)}
												>
													Delete
												</DropdownMenuItem>
											</DropdownMenuContent>
										</DropdownMenu>
									</div>
								</div>
								<div class="flex items-center gap-4 mt-3 text-sm text-muted-foreground">
									{#if milestone.dueDate}
										<div class="flex items-center gap-1">
											<Calendar class="h-4 w-4" />
											<span>Due: {new Date(milestone.dueDate).toLocaleDateString()}</span>
										</div>
									{/if}
									{#if milestone.completedDate}
										<div class="flex items-center gap-1 text-green-600">
											<CheckCircle2 class="h-4 w-4" />
											<span>Completed: {new Date(milestone.completedDate).toLocaleDateString()}</span>
										</div>
									{/if}
								</div>
							</Card>
						</div>
					</div>
				{/each}
				{#if milestones.length === 0}
					<p class="text-muted-foreground">No milestones yet. Create your first milestone to track progress.</p>
				{/if}
			</div>
		</Card>

		{#if editingMilestone}
			<Dialog bind:open={isEditMilestoneDialogOpen}>
				<DialogContent class="sm:max-w-[500px]">
					<DialogHeader>
						<DialogTitle>Edit Milestone</DialogTitle>
						<DialogDescription>Update milestone details</DialogDescription>
					</DialogHeader>
					<div class="grid gap-4 py-4">
						<div class="grid gap-2">
							<Label for="edit-milestone-name">Milestone Name</Label>
							<Input id="edit-milestone-name" bind:value={formName} placeholder="Phase 1: Planning" />
						</div>
						<div class="grid gap-2">
							<Label for="edit-milestone-description">Description</Label>
							<Textarea
								id="edit-milestone-description"
								bind:value={formDescription}
								placeholder="Milestone description..."
							/>
						</div>
						<div class="grid gap-2">
							<Label for="edit-milestone-status">Status</Label>
							<Select type="single" bind:value={formStatus}>
								<SelectTrigger id="edit-milestone-status">
									{#if formStatus === 'pending'}
										Pending
									{:else if formStatus === 'in-progress'}
										In Progress
									{:else if formStatus === 'completed'}
										Completed
									{:else}
										Select status
									{/if}
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="pending">Pending</SelectItem>
									<SelectItem value="in-progress">In Progress</SelectItem>
									<SelectItem value="completed">Completed</SelectItem>
								</SelectContent>
							</Select>
						</div>
						<div class="grid gap-2">
							<Label for="edit-milestone-due-date">Due Date</Label>
							<Input id="edit-milestone-due-date" type="date" bind:value={formDueDate} />
						</div>
					</div>
					{#if formError}
						<div class="rounded-md bg-red-50 p-3">
							<p class="text-sm text-red-800">{formError}</p>
						</div>
					{/if}
					<DialogFooter>
						<Button variant="outline" onclick={closeEditMilestoneDialog}>Cancel</Button>
						<Button onclick={handleUpdateMilestone} disabled={formLoading}>
							{formLoading ? 'Saving...' : 'Save Changes'}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		{/if}

		<!-- Team Section -->
		<Card class="p-6">
			<h3 class="text-lg font-semibold mb-4">Team Members</h3>
			<div class="grid gap-4 md:grid-cols-2">
				{#if teamMembers.length === 0}
					<p class="text-muted-foreground">No team members assigned yet.</p>
				{:else}
					{#each teamMembers as member}
						<Card class="p-6">
							<div class="flex items-center gap-4">
								<div
									class="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground text-lg font-semibold"
								>
									{member.name.substring(0, 2).toUpperCase()}
								</div>
								<div>
									<h4 class="font-semibold">{member.name}</h4>
									<p class="text-sm text-muted-foreground">Team Member</p>
								</div>
							</div>
						</Card>
					{/each}
				{/if}
			</div>
		</Card>

		<!-- Timeline Section -->
		<Card class="p-6">
			<h3 class="text-lg font-semibold mb-4">Timeline</h3>
			<div class="space-y-4">
				<div class="flex items-center justify-between pb-4 border-b">
					<div>
						<p class="text-sm text-muted-foreground">Start Date</p>
						<p class="text-lg font-semibold">
							{#if project.startDate}{new Date(project.startDate).toLocaleDateString()}{:else}—{/if}
						</p>
					</div>
					<div class="text-right">
						<p class="text-sm text-muted-foreground">End Date</p>
						<p class="text-lg font-semibold">
							{#if project.endDate}{new Date(project.endDate).toLocaleDateString()}{:else}—{/if}
						</p>
					</div>
				</div>
				<div>
					<p class="text-sm text-muted-foreground mb-2">Duration</p>
					<p class="text-lg font-semibold">
						{#if project.startDate && project.endDate}
							{Math.ceil(
								(new Date(project.endDate).getTime() -
									new Date(project.startDate).getTime()) /
									(1000 * 60 * 60 * 24)
							)}{' '}
							days
						{:else}
							—
						{/if}
					</p>
				</div>
			</div>
		</Card>
	{/if}
</div>
