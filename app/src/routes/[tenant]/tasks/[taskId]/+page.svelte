<script lang="ts">
	import { getTask, deleteTask, getTasks, approveTask, rejectTask } from '$lib/remotes/tasks.remote';
	import { getTaskComments, createTaskComment, deleteTaskComment, updateTaskComment } from '$lib/remotes/task-comments.remote';
	import { getClient } from '$lib/remotes/clients.remote';
	import { getProject } from '$lib/remotes/projects.remote';
	import { getTenantUsers, getClientUsers } from '$lib/remotes/users.remote';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Label } from '$lib/components/ui/label';
	import RichEditor from '$lib/components/RichEditor/RichEditor.svelte';
	import { MessageSquare, User, Calendar, FolderKanban, Building2, Check, X, Pencil, Trash2, History, Plus, ArrowRight, UserCheck, RefreshCw, Reply } from '@lucide/svelte';
	import { getTaskActivities } from '$lib/remotes/task-activities.remote';
	import { formatStatus, getStatusBadgeVariant, getPriorityColor, getPriorityDotColor, formatPriority, formatDate, getActivityValueColor } from '$lib/components/task-kanban-utils';
	import { toast } from 'svelte-sonner';
	import { clientLogger } from '$lib/client-logger';

	const tenantSlug = $derived(page.params.tenant);
	const taskId = $derived(page.params.taskId!);
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

	const clientUsersQuery = $derived(task?.clientId ? getClientUsers(task.clientId) : null);
	const mentionUsers = $derived(clientUsersQuery?.current || users);

	const projectQuery = $derived(task?.projectId ? getProject(task.projectId) : null);
	const project = $derived(projectQuery?.current);

	const activitiesQuery = getTaskActivities(taskId);
	const activities = $derived(activitiesQuery.current || []);

	let commentLoading = $state(false);
	let approvalLoading = $state(false);
	let editingCommentId = $state<string | null>(null);
	let editingContent = $state('');
	let editLoading = $state(false);
	let newCommentEditor: RichEditor | null = $state(null);
	let editCommentEditor: RichEditor | null = $state(null);
	let replyingToId = $state<string | null>(null);
	let replyEditor: RichEditor | null = $state(null);
	let replyLoading = $state(false);

	const topLevelComments = $derived(comments.filter((c: any) => !c.parentCommentId));
	const repliesMap = $derived(
		comments.reduce((map: Map<string, any[]>, c: any) => {
			if (c.parentCommentId) {
				const existing = map.get(c.parentCommentId) || [];
				existing.push(c);
				map.set(c.parentCommentId, existing);
			}
			return map;
		}, new Map<string, any[]>())
	);

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
		const html = newCommentEditor?.getHTML() ?? '';
		const editorEmpty = newCommentEditor?.isEmpty() ?? true;
		if (editorEmpty) return;

		commentLoading = true;
		try {
			await createTaskComment({
				taskId,
				content: html
			}).updates(getTaskComments(taskId));
			newCommentEditor?.clear();
			toast.success('Comment added');
		} catch (e) {
			clientLogger.apiError('task_add_comment', e);
		} finally {
			commentLoading = false;
		}
	}

	async function handleEditComment(commentId: string) {
		const html = editCommentEditor?.getHTML() ?? '';
		const isEmpty = editCommentEditor?.isEmpty() ?? true;
		if (isEmpty) return;
		editLoading = true;
		try {
			await updateTaskComment({
				commentId,
				content: html
			}).updates(getTaskComments(taskId));
			editingCommentId = null;
			editingContent = '';
			toast.success('Comment updated');
		} catch (e) {
			clientLogger.apiError('task_update_comment', e);
		} finally {
			editLoading = false;
		}
	}

	async function handleReply(parentCommentId: string) {
		const html = replyEditor?.getHTML() ?? '';
		const isEmpty = replyEditor?.isEmpty() ?? true;
		if (isEmpty) return;

		replyLoading = true;
		try {
			await createTaskComment({
				taskId,
				content: html,
				parentCommentId
			}).updates(getTaskComments(taskId));
			replyEditor?.clear();
			replyingToId = null;
			toast.success('Reply added');
		} catch (e) {
			clientLogger.apiError('task_add_reply', e);
		} finally {
			replyLoading = false;
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
			clientLogger.apiError('task_delete_comment', e);
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
			clientLogger.apiError('task_delete', e);
		}
	}

	async function handleApprove() {
		if (!task) return;
		approvalLoading = true;
		try {
			await approveTask({ taskId: task.id }).updates(getTask(taskId), getTasks({}));
			toast.success('Task approved');
		} catch (e) {
			clientLogger.apiError('task_approve', e);
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
			clientLogger.apiError('task_reject', e);
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
						<RichEditor
							bind:this={newCommentEditor}
							placeholder="Write a comment..."
							minHeight="120px"
							showFooter={false}
							users={mentionUsers}
						/>
						<Button onclick={handleAddComment} disabled={commentLoading}>
							{commentLoading ? 'Adding...' : 'Add Comment'}
						</Button>
					</div>

					<div class="space-y-3 pt-4 border-t">
						{#if comments.length === 0}
							<p class="text-sm text-muted-foreground">No comments yet. Be the first to comment!</p>
						{:else}
							{#each topLevelComments as comment}
								{@const authorName = comment.authorName || userMap.get(comment.userId) || comment.userId}
								{@const isOwnComment = currentUserId && comment.userId === currentUserId}
								{@const replies = repliesMap.get(comment.id) || []}
								<div class="p-3 border rounded-lg">
									<div class="flex items-center gap-2 mb-1.5">
										<User class="h-4 w-4 text-muted-foreground" />
										<p class="text-sm font-medium">{authorName}</p>
										<p class="text-xs text-muted-foreground">
											{formatDate(comment.createdAt)}
											{#if comment.updatedAt && new Date(comment.updatedAt).getTime() - new Date(comment.createdAt).getTime() > 1000}
												<span class="italic">(edited)</span>
											{/if}
										</p>
										<div class="flex items-center gap-1 ml-auto">
											<Button variant="ghost" size="icon" class="h-7 w-7" onclick={() => { replyingToId = replyingToId === comment.id ? null : comment.id; }} title="Reply">
												<Reply class="h-3 w-3" />
											</Button>
											{#if isOwnComment && editingCommentId !== comment.id}
												<Button variant="ghost" size="icon" class="h-7 w-7" onclick={() => { editingCommentId = comment.id; editingContent = comment.content; }}>
													<Pencil class="h-3 w-3" />
												</Button>
												<Button variant="ghost" size="icon" class="h-7 w-7" onclick={() => handleDeleteComment(comment.id)}>
													<Trash2 class="h-3 w-3" />
												</Button>
											{/if}
										</div>
									</div>
									{#if editingCommentId === comment.id}
										<div class="space-y-2">
											<RichEditor
												bind:this={editCommentEditor}
												content={editingContent}
												placeholder="Edit comment..."
												minHeight="120px"
												showFooter={false}
												users={mentionUsers}
											/>
											<div class="flex gap-2">
												<Button size="sm" onclick={() => handleEditComment(comment.id)} disabled={editLoading}>
													{editLoading ? 'Saving...' : 'Save'}
												</Button>
												<Button size="sm" variant="outline" onclick={() => { editingCommentId = null; editingContent = ''; }}>
													Cancel
												</Button>
											</div>
										</div>
									{:else}
										<div class="comment-display text-sm">{@html comment.content}</div>
									{/if}

									<!-- Replies -->
									{#if replies.length > 0}
										<div class="mt-3 ml-6 space-y-2 border-l-2 border-muted pl-3">
											{#each replies as reply}
												{@const replyAuthor = reply.authorName || userMap.get(reply.userId) || reply.userId}
												{@const isOwnReply = currentUserId && reply.userId === currentUserId}
												<div class="py-1.5">
													<div class="flex items-center gap-2 mb-1">
														<User class="h-3 w-3 text-muted-foreground" />
														<p class="font-medium text-xs">{replyAuthor}</p>
														<p class="text-xs text-muted-foreground">{formatDate(reply.createdAt)}</p>
														{#if isOwnReply}
															<Button variant="ghost" size="icon" class="h-5 w-5 ml-auto" onclick={() => handleDeleteComment(reply.id)}>
																<Trash2 class="h-2.5 w-2.5" />
															</Button>
														{/if}
													</div>
													<div class="comment-display text-sm ml-5">{@html reply.content}</div>
												</div>
											{/each}
										</div>
									{/if}

									<!-- Reply editor -->
									{#if replyingToId === comment.id}
										<div class="mt-3 ml-6 border-l-2 border-primary/30 pl-3">
											<RichEditor
												bind:this={replyEditor}
												placeholder="Write a reply..."
												minHeight="120px"
												showFooter={false}
												users={mentionUsers}
											/>
											<div class="flex gap-2 mt-2">
												<Button size="sm" onclick={() => handleReply(comment.id)} disabled={replyLoading}>
													{replyLoading ? 'Replying...' : 'Reply'}
												</Button>
												<Button size="sm" variant="outline" onclick={() => { replyingToId = null; }}>
													Cancel
												</Button>
											</div>
										</div>
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
