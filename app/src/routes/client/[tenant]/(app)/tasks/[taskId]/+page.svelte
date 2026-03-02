<script lang="ts">
	import { getTask } from '$lib/remotes/tasks.remote';
	import { getTaskComments, createTaskComment, updateTaskComment, deleteTaskComment } from '$lib/remotes/task-comments.remote';
	import { getTaskActivities } from '$lib/remotes/task-activities.remote';
	import { getTenantUsers } from '$lib/remotes/users.remote';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Separator } from '$lib/components/ui/separator';
	import {
		formatStatus,
		getStatusDotColor,
		getStatusBadgeVariant,
		getPriorityColor,
		getPriorityDotColor,
		formatDate,
		formatPriority,
		getActivityValueColor
	} from '$lib/components/task-kanban-utils';
	import { isTaskOverdue } from '$lib/utils/task-filters';
	import { toast } from 'svelte-sonner';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import CalendarIcon from '@lucide/svelte/icons/calendar';
	import ClockIcon from '@lucide/svelte/icons/clock';
	import FlagIcon from '@lucide/svelte/icons/flag';
	import CircleDotIcon from '@lucide/svelte/icons/circle-dot';
	import AlertTriangleIcon from '@lucide/svelte/icons/alert-triangle';
	import MessageSquareIcon from '@lucide/svelte/icons/message-square';
	import HistoryIcon from '@lucide/svelte/icons/history';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import CheckIcon from '@lucide/svelte/icons/check';
	import XIcon from '@lucide/svelte/icons/x';
	import UserCheckIcon from '@lucide/svelte/icons/user-check';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import SendIcon from '@lucide/svelte/icons/send';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import UserIcon from '@lucide/svelte/icons/user';

	const tenantSlug = $derived(page.params.tenant);
	const taskId = $derived(page.params.taskId);
	const currentUserId = $derived((page.data as any)?.clientUser?.userId as string | undefined);

	const taskQuery = getTask(taskId);
	const task = $derived(taskQuery.current);
	const loading = $derived(taskQuery.loading);
	const error = $derived(taskQuery.error);

	const commentsQuery = getTaskComments(taskId);
	const comments = $derived(commentsQuery.current || []);

	const activitiesQuery = getTaskActivities(taskId);
	const activities = $derived(activitiesQuery.current || []);

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

	const clientRepresentative = $derived(
		(page.data as any)?.client?.legalRepresentative ||
		(page.data as any)?.client?.businessName ||
		(page.data as any)?.client?.name || ''
	);

	function getCreatorName(userId: string | null): string {
		if (!userId) return '';
		return userMap.get(userId) || clientRepresentative || '';
	}

	const overdue = $derived(
		task && task.status !== 'done' && task.status !== 'cancelled' && isTaskOverdue(task.dueDate)
	);

	let newComment = $state('');
	let commentLoading = $state(false);
	let editingCommentId = $state<string | null>(null);
	let editingContent = $state('');
	let editLoading = $state(false);

	function getInitials(name: string): string {
		return name
			.split(' ')
			.map((n) => n[0])
			.join('')
			.toUpperCase()
			.slice(0, 2);
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
		if (!confirm('Delete this comment?')) return;
		try {
			await deleteTaskComment(commentId).updates(getTaskComments(taskId));
			toast.success('Comment deleted');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Failed to delete comment');
		}
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
</script>

<svelte:head>
	<title>{task?.title || 'Task'} - Client Portal</title>
</svelte:head>

<div class="max-w-3xl mx-auto space-y-6">
	<!-- Back button -->
	<Button variant="ghost" size="sm" class="-ml-2" onclick={() => goto(`/client/${tenantSlug}/tasks`)}>
		<ArrowLeftIcon class="mr-2 h-4 w-4" />
		Back to Tasks
	</Button>

	{#if loading}
		<div class="flex items-center justify-center py-12">
			<p class="text-muted-foreground">Loading task...</p>
		</div>
	{:else if error}
		<div class="rounded-xl border border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/50 p-4">
			<p class="text-sm text-red-800 dark:text-red-400">{error instanceof Error ? error.message : 'Failed to load task'}</p>
		</div>
	{:else if task}
		<!-- Header -->
		<div class="space-y-3">
			<h1 class="text-2xl font-bold leading-tight">{task.title}</h1>
			<div class="flex items-center gap-2 flex-wrap">
				<Badge variant={getStatusBadgeVariant(task.status)} class="text-[11px] h-5 rounded-full px-2 font-normal">
					<span class="h-1.5 w-1.5 rounded-full {getStatusDotColor(task.status)} mr-1"></span>
					{formatStatus(task.status)}
				</Badge>
				<Badge class="{getPriorityColor(task.priority || 'medium')} text-[11px] h-5 rounded-full px-2 font-normal">
					<span class="h-1.5 w-1.5 rounded-full {getPriorityDotColor(task.priority)} mr-1"></span>
					{formatPriority(task.priority || 'medium')}
				</Badge>
				{#if overdue}
					<Badge variant="destructive" class="text-[11px] h-5 rounded-full px-2 font-normal">
						<AlertTriangleIcon class="h-3 w-3 mr-1" />
						Overdue
					</Badge>
				{/if}
			</div>
		</div>

		<!-- Description -->
		{#if task.description}
			<div class="rounded-xl border border-border/40 bg-card/50 p-4">
				<p class="text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap">{task.description}</p>
			</div>
		{/if}

		<!-- Metadata grid -->
		<div class="grid grid-cols-2 gap-4">
			<!-- Status -->
			<div class="rounded-xl border border-border/40 bg-card/50 p-4 flex items-center gap-3">
				<div class="flex h-10 w-10 items-center justify-center rounded-lg bg-muted/50">
					<CircleDotIcon class="h-5 w-5 text-muted-foreground" />
				</div>
				<div>
					<p class="text-xs text-muted-foreground">Status</p>
					<p class="text-sm font-medium flex items-center gap-1.5">
						<span class="h-2 w-2 rounded-full {getStatusDotColor(task.status)}"></span>
						{formatStatus(task.status)}
					</p>
				</div>
			</div>

			<!-- Priority -->
			<div class="rounded-xl border border-border/40 bg-card/50 p-4 flex items-center gap-3">
				<div class="flex h-10 w-10 items-center justify-center rounded-lg bg-muted/50">
					<FlagIcon class="h-5 w-5 text-muted-foreground" />
				</div>
				<div>
					<p class="text-xs text-muted-foreground">Priority</p>
					<p class="text-sm font-medium flex items-center gap-1.5">
						<span class="h-2 w-2 rounded-full {getPriorityDotColor(task.priority)}"></span>
						{formatPriority(task.priority || 'medium')}
					</p>
				</div>
			</div>

			<!-- Due Date -->
			<div class="rounded-xl border border-border/40 bg-card/50 p-4 flex items-center gap-3 {overdue ? 'border-red-300 dark:border-red-800' : ''}">
				<div class="flex h-10 w-10 items-center justify-center rounded-lg {overdue ? 'bg-red-500/10' : 'bg-muted/50'}">
					<CalendarIcon class="h-5 w-5 {overdue ? 'text-red-600' : 'text-muted-foreground'}" />
				</div>
				<div>
					<p class="text-xs text-muted-foreground">Due Date</p>
					{#if task.dueDate}
						<p class="text-sm font-medium {overdue ? 'text-red-600' : ''}">{formatDate(task.dueDate)}</p>
						{#if overdue}
							<p class="text-xs text-red-500 mt-0.5">Overdue</p>
						{/if}
					{:else}
						<p class="text-sm text-muted-foreground">Not set</p>
					{/if}
				</div>
			</div>

			<!-- Created -->
			<div class="rounded-xl border border-border/40 bg-card/50 p-4 flex items-center gap-3">
				<div class="flex h-10 w-10 items-center justify-center rounded-lg bg-muted/50">
					<ClockIcon class="h-5 w-5 text-muted-foreground" />
				</div>
				<div>
					<p class="text-xs text-muted-foreground">Created</p>
					<p class="text-sm font-medium">{formatDate(task.createdAt)}</p>
					{#if getCreatorName(task.createdByUserId)}
						<p class="text-xs text-muted-foreground mt-0.5">by {getCreatorName(task.createdByUserId)}</p>
					{/if}
				</div>
			</div>

			<!-- Assignee -->
			{#if task.assignedToUserId && userMap.get(task.assignedToUserId)}
				<div class="rounded-xl border border-border/40 bg-card/50 p-4 flex items-center gap-3">
					<div class="flex h-10 w-10 items-center justify-center rounded-lg bg-muted/50">
						<UserIcon class="h-5 w-5 text-muted-foreground" />
					</div>
					<div>
						<p class="text-xs text-muted-foreground">Assignee</p>
						<p class="text-sm font-medium">{userMap.get(task.assignedToUserId)}</p>
					</div>
				</div>
			{/if}
		</div>

		<Separator />

		<!-- Comments -->
		<div>
			<div class="flex items-center gap-2 mb-4">
				<MessageSquareIcon class="h-4 w-4 text-muted-foreground" />
				<h3 class="font-semibold">Comments ({comments.length})</h3>
			</div>

			<div class="space-y-4 mb-6">
				{#if comments.length === 0}
					<p class="text-sm text-muted-foreground">No comments yet. Be the first to comment!</p>
				{:else}
					{#each comments as comment}
						{@const authorName = userMap.get(comment.userId) || 'User'}
						{@const isOwnComment = currentUserId && comment.userId === currentUserId}
						<div class="flex gap-3">
							<div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-semibold mt-0.5">
								{getInitials(authorName)}
							</div>
							<div class="flex-1 min-w-0">
								<div class="flex items-center gap-2 mb-1">
									<p class="text-sm font-medium">{authorName}</p>
									<p class="text-xs text-muted-foreground">
										{timeAgo(comment.createdAt)}
										{#if comment.updatedAt && new Date(comment.updatedAt).getTime() - new Date(comment.createdAt).getTime() > 1000}
											<span class="italic">(edited)</span>
										{/if}
									</p>
									{#if isOwnComment && editingCommentId !== comment.id}
										<div class="flex items-center gap-0.5 ml-auto">
											<Button variant="ghost" size="icon" class="h-6 w-6" onclick={() => { editingCommentId = comment.id; editingContent = comment.content; }}>
												<PencilIcon class="h-3 w-3" />
											</Button>
											<Button variant="ghost" size="icon" class="h-6 w-6" onclick={() => handleDeleteComment(comment.id)}>
												<Trash2Icon class="h-3 w-3" />
											</Button>
										</div>
									{/if}
								</div>
								{#if editingCommentId === comment.id}
									<div class="space-y-2">
										<Textarea bind:value={editingContent} rows={3} class="text-sm" />
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
									<div class="rounded-lg bg-muted/30 border border-border/30 px-3 py-2">
										<p class="text-sm leading-relaxed">{comment.content}</p>
									</div>
								{/if}
							</div>
						</div>
					{/each}
				{/if}
			</div>

			<!-- Add comment form -->
			<div class="flex gap-3">
				<div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground text-xs font-semibold mt-0.5">
					<UserIcon class="h-4 w-4" />
				</div>
				<div class="flex-1 space-y-2">
					<Textarea
						placeholder="Write a comment..."
						bind:value={newComment}
						rows={3}
						class="text-sm"
					/>
					<Button size="sm" onclick={handleAddComment} disabled={!newComment.trim() || commentLoading}>
						<SendIcon class="mr-2 h-3.5 w-3.5" />
						{commentLoading ? 'Posting...' : 'Post Comment'}
					</Button>
				</div>
			</div>
		</div>

		<Separator />

		<!-- Activity timeline -->
		<div>
			<div class="flex items-center gap-2 mb-4">
				<HistoryIcon class="h-4 w-4 text-muted-foreground" />
				<h3 class="font-semibold">Activity ({activities.length})</h3>
			</div>

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
										<PlusIcon class="h-3.5 w-3.5" />
									{:else if activity.action === 'commented'}
										<MessageSquareIcon class="h-3.5 w-3.5" />
									{:else if activity.action === 'approved'}
										<CheckIcon class="h-3.5 w-3.5" />
									{:else if activity.action === 'rejected'}
										<XIcon class="h-3.5 w-3.5" />
									{:else if activity.action === 'status_changed'}
										<ArrowRightIcon class="h-3.5 w-3.5" />
									{:else if activity.action === 'assigned'}
										<UserCheckIcon class="h-3.5 w-3.5" />
									{:else}
										<RefreshCwIcon class="h-3.5 w-3.5" />
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
												<ArrowRightIcon class="h-3 w-3 text-muted-foreground shrink-0" />
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
		</div>
	{:else}
		<div class="flex flex-col items-center justify-center py-12">
			<p class="text-muted-foreground">Task not found</p>
		</div>
	{/if}
</div>
