<script lang="ts">
	import { getTaskComments, createTaskComment } from '$lib/remotes/task-comments.remote';
	import { getProjects } from '$lib/remotes/projects.remote';
	import { getTenantUsers } from '$lib/remotes/users.remote';
	import { goto } from '$app/navigation';
	import { Dialog, DialogContent, DialogHeader, DialogTitle } from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Separator } from '$lib/components/ui/separator';
	import EditTaskDialog from '$lib/components/edit-task-dialog.svelte';
	import { Calendar, User, MessageSquare, Edit } from '@lucide/svelte';
	import type { Task } from '$lib/server/db/schema';

	interface Props {
		task: Task | null;
		open: boolean;
		onOpenChange: (open: boolean) => void;
		tenantSlug?: string;
	}

	let { task, open, onOpenChange, tenantSlug = '' }: Props = $props();

	let isEditOpen = $state(false);
	let newComment = $state('');
	let commentLoading = $state(false);

	const commentsQuery = $derived(task ? getTaskComments(task.id) : null);
	const comments = $derived(commentsQuery?.current || []);

	const usersQuery = getTenantUsers();
	const users = $derived(usersQuery.current || []);
	const userMap = $derived(new Map(users.map((u) => [u.id, u.username])));

	const projectsQuery = getProjects(undefined);
	const projects = $derived(projectsQuery.current || []);
	const projectMap = $derived(new Map(projects.map((p) => [p.id, p.name])));

	function getPriorityBadgeVariant(priority: string) {
		switch (priority) {
			case 'urgent':
				return 'destructive';
			case 'high':
				return 'default';
			default:
				return 'secondary';
		}
	}

	function getInitials(name: string): string {
		return name
			.split(' ')
			.map((n) => n[0])
			.join('')
			.toUpperCase()
			.slice(0, 2);
	}

	async function handleAddComment() {
		if (!newComment.trim() || !task) return;

		commentLoading = true;
		try {
			await createTaskComment({
				taskId: task.id,
				content: newComment.trim()
			});
			newComment = '';
			if (commentsQuery && 'refetch' in commentsQuery) {
				(commentsQuery as any).refetch();
			}
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Failed to add comment');
		} finally {
			commentLoading = false;
		}
	}
</script>

{#if task}
	<Dialog bind:open onOpenChange={onOpenChange}>
		<DialogContent class="max-w-3xl max-h-[90vh] overflow-y-auto">
			<DialogHeader>
				<div class="flex items-start justify-between">
					<div class="flex-1">
						<DialogTitle class="text-2xl">{task.title}</DialogTitle>
						{#if task.projectId && projectMap.has(task.projectId)}
							<a
								href="/{tenantSlug}/projects/{task.projectId}"
								class="hover:text-primary"
								onclick={(e) => {
									e.preventDefault();
									goto(`/${tenantSlug}/projects/${task.projectId}`);
									onOpenChange(false);
								}}
							>
								<p class="text-sm text-muted-foreground mt-2">{projectMap.get(task.projectId)}</p>
							</a>
						{/if}
						<div class="flex items-center gap-2 mt-3">
							<Badge variant={getPriorityBadgeVariant(task.priority || 'medium')}>
								{task.priority || 'medium'}
							</Badge>
							<Badge variant="outline">{task.status}</Badge>
						</div>
					</div>
					<Button variant="outline" size="sm" onclick={() => (isEditOpen = true)}>
						<Edit class="mr-2 h-4 w-4" />
						Edit
					</Button>
				</div>
			</DialogHeader>

			<div class="space-y-6 mt-4">
				{#if task.description}
					<div>
						<h4 class="font-semibold mb-2">Description</h4>
						<p class="text-muted-foreground leading-relaxed">{task.description}</p>
					</div>
					<Separator />
				{/if}

				<div class="grid gap-4 md:grid-cols-2">
					{#if task.assignedToUserId}
						<div class="flex items-center gap-3">
							<div class="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
								<User class="h-5 w-5 text-primary" />
							</div>
							<div>
								<p class="text-sm text-muted-foreground">Assignee</p>
								<p class="font-medium">{userMap.get(task.assignedToUserId) || task.assignedToUserId}</p>
							</div>
						</div>
					{/if}

					{#if task.dueDate}
						<div class="flex items-center gap-3">
							<div class="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-500/10">
								<Calendar class="h-5 w-5 text-blue-600" />
							</div>
							<div>
								<p class="text-sm text-muted-foreground">Due Date</p>
								<p class="font-medium">{new Date(task.dueDate).toLocaleDateString()}</p>
							</div>
						</div>
					{/if}
				</div>

				<Separator />

				<div>
					<div class="flex items-center gap-2 mb-4">
						<MessageSquare class="h-4 w-4 text-muted-foreground" />
						<h4 class="font-semibold">Comments ({comments.length})</h4>
					</div>

					<div class="space-y-4 mb-4">
						{#if comments.length === 0}
							<p class="text-sm text-muted-foreground">No comments yet. Be the first to comment!</p>
						{:else}
							{#each comments as comment}
								{@const authorName = userMap.get(comment.userId) || comment.userId}
								<div class="border rounded-lg p-4">
									<div class="flex items-center gap-3 mb-2">
										<div class="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-semibold">
											{getInitials(authorName)}
										</div>
										<div>
											<p class="font-medium text-sm">{authorName}</p>
											<p class="text-xs text-muted-foreground">
												{new Date(comment.createdAt).toLocaleString()}
											</p>
										</div>
									</div>
									<p class="text-sm leading-relaxed">{comment.content}</p>
								</div>
							{/each}
						{/if}
					</div>

					<div class="space-y-2">
						<Textarea
							placeholder="Add a comment..."
							bind:value={newComment}
							rows={3}
						/>
						<Button size="sm" onclick={handleAddComment} disabled={!newComment.trim() || commentLoading}>
							{commentLoading ? 'Posting...' : 'Post Comment'}
						</Button>
					</div>
				</div>
			</div>
		</DialogContent>
	</Dialog>

	{#if task}
		<EditTaskDialog task={task} open={isEditOpen} onOpenChange={(open) => (isEditOpen = open)} />
	{/if}
{/if}
