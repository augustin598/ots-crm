<script lang="ts">
	import { getTask, deleteTask } from '$lib/remotes/tasks.remote';
	import { getTaskComments, createTaskComment, deleteTaskComment } from '$lib/remotes/task-comments.remote';
	import { getClient } from '$lib/remotes/clients.remote';
	import { getProject } from '$lib/remotes/projects.remote';
	import { getTenantUsers } from '$lib/remotes/users.remote';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Label } from '$lib/components/ui/label';
	import { MessageSquare, User, Calendar, FolderKanban, Building2 } from '@lucide/svelte';

	const tenantSlug = $derived(page.params.tenant);
	const taskId = $derived(page.params.taskId);

	const taskQuery = getTask(taskId);
	const task = $derived(taskQuery.current);
	const loading = $derived(taskQuery.loading);
	const error = $derived(taskQuery.error);

	const commentsQuery = getTaskComments(taskId);
	const comments = $derived(commentsQuery.current || []);

	const usersQuery = getTenantUsers();
	const users = $derived(usersQuery.current || []);
	const userMap = $derived(new Map(users.map((u) => [u.id, u.username])));

	const clientQuery = $derived(task?.clientId ? getClient(task.clientId) : null);
	const client = $derived(clientQuery?.current);

	const projectQuery = $derived(task?.projectId ? getProject(task.projectId) : null);
	const project = $derived(projectQuery?.current);

	let newComment = $state('');
	let commentLoading = $state(false);

	function getStatusColor(status: string) {
		switch (status) {
			case 'todo':
				return 'secondary';
			case 'in-progress':
				return 'default';
			case 'review':
				return 'outline';
			case 'done':
				return 'secondary';
			case 'cancelled':
				return 'destructive';
			default:
				return 'secondary';
		}
	}

	function getPriorityColor(priority: string) {
		switch (priority) {
			case 'urgent':
				return 'bg-red-100 text-red-700';
			case 'high':
				return 'bg-orange-100 text-orange-700';
			case 'medium':
				return 'bg-blue-100 text-blue-700';
			case 'low':
				return 'bg-gray-100 text-gray-700';
			default:
				return 'bg-gray-100 text-gray-700';
		}
	}

	async function handleAddComment() {
		if (!newComment.trim()) return;

		commentLoading = true;
		try {
			await createTaskComment({
				taskId,
				content: newComment.trim()
			});
			newComment = '';
			commentsQuery.refetch();
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Failed to add comment');
		} finally {
			commentLoading = false;
		}
	}

	async function handleDeleteComment(commentId: string) {
		if (!confirm('Are you sure you want to delete this comment?')) {
			return;
		}

		try {
			await deleteTaskComment(commentId);
			commentsQuery.refetch();
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Failed to delete comment');
		}
	}

	async function handleDeleteTask() {
		if (!confirm('Are you sure you want to delete this task?')) {
			return;
		}

		try {
			await deleteTask(taskId);
			goto(`/${tenantSlug}/tasks`);
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Failed to delete task');
		}
	}
</script>

<svelte:head>
	<title>{task?.title || 'Task'} - CRM</title>
</svelte:head>

<div class="space-y-6">
	{#if loading}
		<p>Loading task...</p>
	{:else if error}
		<div class="rounded-md bg-red-50 p-3">
			<p class="text-sm text-red-800">{error instanceof Error ? error.message : 'Failed to load task'}</p>
		</div>
	{:else if task}
		<div class="flex items-center justify-between">
			<h1 class="text-3xl font-bold">{task.title}</h1>
			<div class="flex items-center gap-2">
				<Button variant="outline" onclick={() => goto(`/${tenantSlug}/tasks/${taskId}/edit`)}>
					Edit
				</Button>
				<Button variant="destructive" onclick={handleDeleteTask}>
					Delete
				</Button>
			</div>
		</div>

		<div class="grid gap-6 md:grid-cols-2">
			<Card>
				<CardHeader>
					<CardTitle>Task Details</CardTitle>
				</CardHeader>
				<CardContent class="space-y-4">
					<div>
						<p class="text-sm text-muted-foreground mb-1">Status</p>
						<Badge variant={getStatusColor(task.status)}>{task.status}</Badge>
					</div>
					<div>
						<p class="text-sm text-muted-foreground mb-1">Priority</p>
						<Badge class={getPriorityColor(task.priority || 'medium')}>
							{task.priority || 'medium'}
						</Badge>
					</div>
					{#if task.description}
						<div>
							<p class="text-sm text-muted-foreground mb-1">Description</p>
							<p class="font-medium">{task.description}</p>
						</div>
					{/if}
					{#if task.dueDate}
						<div class="flex items-center gap-2">
							<Calendar class="h-4 w-4 text-muted-foreground" />
							<div>
								<p class="text-sm text-muted-foreground">Due Date</p>
								<p class="font-medium">{new Date(task.dueDate).toLocaleDateString()}</p>
							</div>
						</div>
					{/if}
					{#if task.assignedToUserId}
						<div class="flex items-center gap-2">
							<User class="h-4 w-4 text-muted-foreground" />
							<div>
								<p class="text-sm text-muted-foreground">Assigned To</p>
								<p class="font-medium">{userMap.get(task.assignedToUserId) || task.assignedToUserId}</p>
							</div>
						</div>
					{/if}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Related Information</CardTitle>
				</CardHeader>
				<CardContent class="space-y-4">
					{#if project}
						<div class="flex items-center gap-3">
							<FolderKanban class="h-5 w-5 text-muted-foreground" />
							<div>
								<p class="font-medium">{project.name}</p>
								<p class="text-sm text-muted-foreground">Project</p>
							</div>
							<Button variant="ghost" size="sm" onclick={() => goto(`/${tenantSlug}/projects/${project.id}`)}>
								View
							</Button>
						</div>
					{/if}
					{#if client}
						<div class="flex items-center gap-3">
							<Building2 class="h-5 w-5 text-muted-foreground" />
							<div>
								<p class="font-medium">{client.name}</p>
								<p class="text-sm text-muted-foreground">Client</p>
							</div>
							<Button variant="ghost" size="sm" onclick={() => goto(`/${tenantSlug}/clients/${client.id}`)}>
								View
							</Button>
						</div>
					{/if}
				</CardContent>
			</Card>

			<Card class="md:col-span-2">
				<CardHeader>
					<CardTitle>Comments</CardTitle>
					<CardDescription>Add comments and notes about this task</CardDescription>
				</CardHeader>
				<CardContent class="space-y-4">
					<div class="space-y-2">
						<Label for="newComment">Add Comment</Label>
						<Textarea
							id="newComment"
							bind:value={newComment}
							placeholder="Write a comment..."
							rows="3"
						/>
						<Button onclick={handleAddComment} disabled={commentLoading || !newComment.trim()}>
							{commentLoading ? 'Adding...' : 'Add Comment'}
						</Button>
					</div>

					<div class="space-y-3 pt-4 border-t">
						{#if comments.length === 0}
							<p class="text-sm text-muted-foreground">No comments yet. Be the first to comment!</p>
						{:else}
							{#each comments as comment}
								<div class="p-3 border rounded-lg">
									<div class="flex items-start justify-between mb-2">
										<div class="flex items-center gap-2">
											<User class="h-4 w-4 text-muted-foreground" />
											<p class="text-sm font-medium">{userMap.get(comment.userId) || comment.userId}</p>
											<p class="text-xs text-muted-foreground">
												{new Date(comment.createdAt).toLocaleDateString()}
											</p>
										</div>
										<Button variant="ghost" size="sm" onclick={() => handleDeleteComment(comment.id)}>
											Delete
										</Button>
									</div>
									<p class="text-sm">{comment.content}</p>
								</div>
							{/each}
						{/if}
					</div>
				</CardContent>
			</Card>
		</div>
	{:else}
		<p>Task not found</p>
	{/if}
</div>
