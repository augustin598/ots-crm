<script lang="ts">
	import { getTask, deleteTask, getTasks, approveTask, rejectTask } from '$lib/remotes/tasks.remote';
	import { getTaskComments, createTaskComment, deleteTaskComment, updateTaskComment } from '$lib/remotes/task-comments.remote';
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
	import { MessageSquare, User, Calendar, FolderKanban, Building2, Check, X, Pencil, History, Plus, ArrowRight, UserCheck, RefreshCw } from '@lucide/svelte';
	import { getTaskActivities } from '$lib/remotes/task-activities.remote';
	import { formatStatus, getStatusBadgeVariant, getPriorityColor, getPriorityDotColor, formatPriority, formatDate, getActivityValueColor } from '$lib/components/task-kanban-utils';
	import { toast } from 'svelte-sonner';

	const tenantSlug = $derived(page.params.tenant);
	const taskId = $derived(page.params.taskId);
	const currentUserId = $derived((page.data as any)?.tenantUser?.userId as string | undefined);

	const taskQuery = getTask(taskId);
	const task = $derived(taskQuery.current);
	const loading = $derived(taskQuery.loading);
	const error = $derived(taskQuery.error);

	const commentsQuery = getTaskComments(taskId);
	const comments = $derived(commentsQuery.current || []);

	const usersQuery = getTenantUsers();
	const users = $derived(usersQuery.current || []);
	const userMap = $derived(
		new Map(
			users.map((u) => [
				u.id,
				`${u.firstName} ${u.lastName}`.trim() || u.email
			])
		)
	);

	const clientQuery = $derived(task?.clientId ? getClient(task.clientId) : null);
	const client = $derived(clientQuery?.current);

	const projectQuery = $derived(task?.projectId ? getProject(task.projectId) : null);
	const project = $derived(projectQuery?.current);

	const activitiesQuery = getTaskActivities(taskId);
	const activities = $derived(activitiesQuery.current || []);

	let newComment = $state('');
	let commentLoading = $state(false);
	let approvalLoading = $state(false);
	let editingCommentId = $state<string | null>(null);
	let editingContent = $state('');
	let editLoading = $state(false);

	function getActivityVerb(activity: { action: string; field?: string | null }): string {
		switch (activity.action) {
			case 'created': return 'created this task';
			case 'commented': return 'added a comment';
			case 'approved': return 'approved the task';
			case 'rejected': return 'rejected the task';
			case 'status_changed': return 'changed status';
			case 'assigned': return 'changed assignee';
			case 'updated': return activity.field ? `updated ${activity.field}` : 'updated the task';
			default: return activity.action;
		}
	}

	function getActivityIconColor(action: string): string {
		switch (action) {
			case 'created': return 'bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400';
			case 'commented': return 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400';
			case 'approved': return 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400';
			case 'rejected': return 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400';
			case 'status_changed': return 'bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400';
			case 'assigned': return 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400';
			default: return 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400';
		}
	}

	function timeAgo(date: Date | string): string {
		const now = new Date();
		const d = new Date(date);
		const diff = Math.floor((now.getTime() - d.getTime()) / 1000);
		if (diff < 60) return 'just now';
		if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
		if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
		if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
		return d.toLocaleDateString('ro-RO', { day: 'numeric', month: 'short', year: 'numeric' });
	}

	async function handleAddComment() {
		if (!newComment.trim()) return;

		commentLoading = true;
		try {
			await createTaskComment({
				taskId,
				content: newComment.trim()
			}).updates(getTaskComments(taskId));
			newComment = '';
			toast.success('Comment added');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Failed to add comment');
		} finally {
			commentLoading = false;
		}
	}

	async function handleEditComment(commentId: string) {
		if (!editingContent.trim()) return;
		editLoading = true;
		try {
			await updateTaskComment({
				commentId,
				content: editingContent.trim()
			}).updates(getTaskComments(taskId));
			editingCommentId = null;
			editingContent = '';
			toast.success('Comment updated');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Failed to update comment');
		} finally {
			editLoading = false;
		}
	}

	async function handleDeleteComment(commentId: string) {
		if (!confirm('Are you sure you want to delete this comment?')) {
			return;
		}

		try {
			await deleteTaskComment(commentId).updates(getTaskComments(taskId));
			toast.success('Comment deleted');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Failed to delete comment');
		}
	}

	async function handleDeleteTask() {
		if (!confirm('Are you sure you want to delete this task?')) {
			return;
		}

		try {
			await deleteTask(taskId).updates(getTask(taskId));
			toast.success('Task deleted');
			goto(`/${tenantSlug}/tasks`);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Failed to delete task');
		}
	}

	async function handleApprove() {
		if (!task) return;
		approvalLoading = true;
		try {
			await approveTask({ taskId: task.id }).updates(getTask(taskId), getTasks({}));
			toast.success('Task approved');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Failed to approve task');
		} finally {
			approvalLoading = false;
		}
	}

	async function handleReject() {
		if (!task) return;
		if (!confirm('Are you sure you want to reject this task?')) return;
		approvalLoading = true;
		try {
			await rejectTask(task.id).updates(getTask(taskId), getTasks({}));
			toast.success('Task rejected');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Failed to reject task');
		} finally {
			approvalLoading = false;
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
				{#if task.status === 'pending-approval'}
					<Button variant="default" onclick={handleApprove} disabled={approvalLoading}>
						<Check class="mr-2 h-4 w-4" />
						Approve
					</Button>
					<Button variant="destructive" size="sm" onclick={handleReject} disabled={approvalLoading}>
						<X class="mr-2 h-4 w-4" />
						Reject
					</Button>
				{/if}
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
						<Badge variant={getStatusBadgeVariant(task.status)}>{formatStatus(task.status)}</Badge>
					</div>
					<div>
						<p class="text-sm text-muted-foreground mb-1">Priority</p>
						<Badge class={getPriorityColor(task.priority || 'medium')}>
							{formatPriority(task.priority || 'medium')}
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
								<p class="font-medium">{formatDate(task.dueDate)}</p>
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
												{formatDate(comment.createdAt)}
												{#if comment.updatedAt && new Date(comment.updatedAt).getTime() - new Date(comment.createdAt).getTime() > 1000}
													<span class="italic">(edited)</span>
												{/if}
											</p>
										</div>
										{#if currentUserId && comment.userId === currentUserId && editingCommentId !== comment.id}
											<div class="flex items-center gap-1">
												<Button variant="ghost" size="sm" onclick={() => { editingCommentId = comment.id; editingContent = comment.content; }}>
													<Pencil class="h-3 w-3 mr-1" />
													Edit
												</Button>
												<Button variant="ghost" size="sm" onclick={() => handleDeleteComment(comment.id)}>
													Delete
												</Button>
											</div>
										{/if}
									</div>
									{#if editingCommentId === comment.id}
										<div class="space-y-2">
											<Textarea bind:value={editingContent} rows={3} />
											<div class="flex gap-2">
												<Button size="sm" onclick={() => handleEditComment(comment.id)} disabled={editLoading || !editingContent.trim()}>
													{editLoading ? 'Saving...' : 'Save'}
												</Button>
												<Button size="sm" variant="outline" onclick={() => { editingCommentId = null; editingContent = ''; }}>
													Cancel
												</Button>
											</div>
										</div>
									{:else}
										<p class="text-sm">{comment.content}</p>
									{/if}
								</div>
							{/each}
						{/if}
					</div>
				</CardContent>
			</Card>

			<Card class="md:col-span-2">
				<CardHeader>
					<CardTitle class="flex items-center gap-2">
						<History class="h-5 w-5" />
						Activity
					</CardTitle>
					<CardDescription>Task history and changes</CardDescription>
				</CardHeader>
				<CardContent>
					{#if activities.length === 0}
						<p class="text-sm text-muted-foreground">No activity recorded yet.</p>
					{:else}
						<div class="relative">
							<div class="absolute left-[15px] top-0 bottom-0 w-px bg-border"></div>
							<div class="space-y-4">
								{#each activities as activity}
									{@const actorName = activity.userName || userMap.get(activity.userId) || activity.userId}
									<div class="flex items-start gap-3 relative">
										<div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full {getActivityIconColor(activity.action)} z-10">
											{#if activity.action === 'created'}
												<Plus class="h-3.5 w-3.5" />
											{:else if activity.action === 'commented'}
												<MessageSquare class="h-3.5 w-3.5" />
											{:else if activity.action === 'approved'}
												<Check class="h-3.5 w-3.5" />
											{:else if activity.action === 'rejected'}
												<X class="h-3.5 w-3.5" />
											{:else if activity.action === 'status_changed'}
												<ArrowRight class="h-3.5 w-3.5" />
											{:else if activity.action === 'assigned'}
												<UserCheck class="h-3.5 w-3.5" />
											{:else}
												<RefreshCw class="h-3.5 w-3.5" />
											{/if}
										</div>
										<div class="flex-1 min-w-0 pt-0.5">
											<p class="text-sm">
												<span class="font-medium">{actorName}</span>
												<span class="text-muted-foreground"> {getActivityVerb(activity)}</span>
											</p>
											{#if activity.oldValue || activity.newValue}
												<div class="flex items-center gap-1.5 mt-1 flex-wrap">
													{#if activity.oldValue}
														<Badge variant="outline" class="text-xs font-normal {getActivityValueColor(activity.field, activity.oldValue)}">{activity.oldValue}</Badge>
													{/if}
													{#if activity.oldValue && activity.newValue}
														<ArrowRight class="h-3 w-3 text-muted-foreground shrink-0" />
													{/if}
													{#if activity.newValue}
														<Badge variant="secondary" class="text-xs font-normal {getActivityValueColor(activity.field, activity.newValue)}">{activity.newValue}</Badge>
													{/if}
												</div>
											{/if}
											<p class="text-xs text-muted-foreground mt-1">{timeAgo(activity.createdAt)}</p>
										</div>
									</div>
								{/each}
							</div>
						</div>
					{/if}
				</CardContent>
			</Card>
		</div>
	{:else}
		<p>Task not found</p>
	{/if}
</div>
