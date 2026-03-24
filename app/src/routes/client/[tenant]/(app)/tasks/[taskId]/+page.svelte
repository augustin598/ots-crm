<script lang="ts">
	import { getTask } from '$lib/remotes/tasks.remote';
	import { getTaskComments, createTaskComment, updateTaskComment, deleteTaskComment, getCommentAttachmentUrl } from '$lib/remotes/task-comments.remote';
	import ImageLightbox from '$lib/components/image-lightbox.svelte';
	import { getTaskActivities } from '$lib/remotes/task-activities.remote';
	import { getTaskMaterials } from '$lib/remotes/task-materials.remote';
	import { getTenantUsers } from '$lib/remotes/users.remote';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Separator } from '$lib/components/ui/separator';
	import RichEditor from '$lib/components/RichEditor/RichEditor.svelte';
	import ReplyIcon from '@lucide/svelte/icons/reply';
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
	import LinkIcon from '@lucide/svelte/icons/link';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import ImageIcon from '@lucide/svelte/icons/image';
	import VideoIcon from '@lucide/svelte/icons/video';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import TypeIcon from '@lucide/svelte/icons/type';
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

	const materialsQuery = getTaskMaterials(taskId);
	const taskMaterials = $derived(materialsQuery.current || []);

	const MATERIAL_TYPE_ICONS: Record<string, any> = {
		image: ImageIcon,
		video: VideoIcon,
		document: FileTextIcon,
		text: TypeIcon,
		url: ExternalLinkIcon
	};

	function parseSocialSets(textContent: string | null): { title: string; urls: string[] }[] {
		if (!textContent) return [];
		try {
			const parsed = JSON.parse(textContent);
			if (!Array.isArray(parsed)) return [];
			if (parsed.length > 0 && typeof parsed[0] === 'object' && 'title' in parsed[0]) {
				return parsed.filter((s: any) => s.title && Array.isArray(s.urls));
			}
			const urls = parsed.filter((u: any) => typeof u === 'string' && u.trim());
			if (urls.length > 0) return [{ title: '', urls }];
		} catch { /* not JSON */ }
		return [];
	}

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

	let commentLoading = $state(false);
	let editingCommentId = $state<string | null>(null);
	let editingContent = $state('');
	let editLoading = $state(false);
	let descExpanded = $state(false);
	let attachmentUrls = $state<Record<string, string>>({});
	let lightboxSrc = $state('');
	let lightboxOpen = $state(false);
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

	async function loadAttachmentUrl(commentId: string) {
		if (attachmentUrls[commentId]) return;
		try {
			const result = await getCommentAttachmentUrl(commentId).current;
			if (result?.url) {
				attachmentUrls = { ...attachmentUrls, [commentId]: result.url };
			}
		} catch {
			// Silently fail
		}
	}

	function openLightbox(src: string) {
		lightboxSrc = src;
		lightboxOpen = true;
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
			toast.error(e instanceof Error ? e.message : 'Failed to add comment');
		} finally {
			commentLoading = false;
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
			toast.error(e instanceof Error ? e.message : 'Failed to add reply');
		} finally {
			replyLoading = false;
		}
	}
</script>

<svelte:head>
	<title>{task?.title || 'Task'} - Client Portal</title>
</svelte:head>

<div class="max-w-5xl mx-auto">
	<!-- Back button -->
	<Button variant="ghost" size="sm" class="-ml-2 mb-4" onclick={() => goto(`/client/${tenantSlug}/tasks`)}>
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
		<div class="mb-5">
			<h1 class="text-xl font-bold leading-tight mb-2">{task.title}</h1>
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

		<!-- Two-column layout -->
		<div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
			<!-- Main content (left, wider) -->
			<div class="lg:col-span-2 space-y-5">
				<!-- Description -->
				{#if task.description}
					{@const isLong = task.description.split('\n').length > 3 || task.description.length > 300}
					<div class="rounded-lg border border-border/40 bg-card/50 p-4">
						<p class="text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap {!descExpanded && isLong ? 'line-clamp-3' : ''}">{task.description}</p>
						{#if isLong}
							<button
								class="text-xs text-primary hover:underline mt-1 cursor-pointer"
								onclick={() => descExpanded = !descExpanded}
							>
								{descExpanded ? 'Show less' : 'Read more...'}
							</button>
						{/if}
					</div>
				{/if}

				<!-- Materials -->
				{#if taskMaterials.length > 0}
					<div>
						<div class="flex items-center gap-2 mb-3">
							<LinkIcon class="h-4 w-4 text-muted-foreground" />
							<h3 class="text-sm font-semibold">Materiale ({taskMaterials.length})</h3>
						</div>
						<div class="space-y-2">
							{#each taskMaterials as mat}
								{@const Icon = MATERIAL_TYPE_ICONS[mat.materialType] || FileTextIcon}
								{@const socialSets = mat.materialType === 'url' ? parseSocialSets(mat.materialTextContent) : []}
								<div class="border rounded-lg p-3 space-y-2">
									<div class="flex items-center gap-3">
										<div class="flex h-8 w-8 items-center justify-center rounded-lg bg-muted shrink-0">
											<Icon class="h-4 w-4 text-muted-foreground" />
										</div>
										<div class="flex-1 min-w-0">
											{#if mat.materialExternalUrl}
												<a href={mat.materialExternalUrl} target="_blank" rel="noopener noreferrer"
													class="text-sm font-medium truncate block hover:text-primary">
													{mat.materialTitle}
												</a>
											{:else}
												<p class="text-sm font-medium truncate">{mat.materialTitle}</p>
											{/if}
											<p class="text-xs text-muted-foreground capitalize">{mat.materialCategory.replace(/-/g, ' ')} &middot; {mat.materialType}</p>
										</div>
									</div>
									{#if socialSets.length > 0}
										<div class="grid gap-2 sm:grid-cols-2 pl-2">
											{#each socialSets as set}
												<div class="border-l-2 border-muted pl-3">
													{#if set.title}
														<p class="text-xs font-semibold text-foreground/80 mb-0.5">{set.title}</p>
													{/if}
													<div class="space-y-0.5">
														{#each set.urls as url}
															<a href={url} target="_blank" rel="noopener noreferrer"
																class="flex items-center gap-1 text-[11px] text-blue-600 dark:text-blue-400 hover:underline truncate">
																<ExternalLinkIcon class="h-3 w-3 shrink-0 opacity-60" />
																<span class="truncate">{url}</span>
															</a>
														{/each}
													</div>
												</div>
											{/each}
										</div>
									{/if}
								</div>
							{/each}
						</div>
					</div>
				{/if}

				<Separator />

				<!-- Comments -->
				<div>
					<div class="flex items-center gap-2 mb-3">
						<MessageSquareIcon class="h-4 w-4 text-muted-foreground" />
						<h3 class="text-sm font-semibold">Comments ({comments.length})</h3>
					</div>

					<div class="space-y-3 mb-4">
						{#if comments.length === 0}
							<p class="text-sm text-muted-foreground">No comments yet. Be the first to comment!</p>
						{:else}
							{#each topLevelComments as comment}
								{@const authorName = comment.authorName || userMap.get(comment.userId) || 'User'}
								{@const isOwnComment = currentUserId && comment.userId === currentUserId}
								{@const replies = repliesMap.get(comment.id) || []}
								<div class="flex gap-3">
									<div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px] font-semibold mt-0.5">
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
											<div class="flex items-center gap-0.5 ml-auto">
												<Button variant="ghost" size="icon" class="h-6 w-6" onclick={() => { replyingToId = replyingToId === comment.id ? null : comment.id; }} title="Reply">
													<ReplyIcon class="h-3 w-3" />
												</Button>
												{#if isOwnComment && editingCommentId !== comment.id}
													<Button variant="ghost" size="icon" class="h-6 w-6" onclick={() => { editingCommentId = comment.id; editingContent = comment.content; }}>
														<PencilIcon class="h-3 w-3" />
													</Button>
													<Button variant="ghost" size="icon" class="h-6 w-6" onclick={() => handleDeleteComment(comment.id)}>
														<Trash2Icon class="h-3 w-3" />
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
													{users}
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
											<div class="rounded-lg bg-muted/30 border border-border/30 px-3 py-2">
												<div class="comment-display text-sm leading-relaxed">{@html comment.content}</div>
											</div>
										{/if}
										{#if comment.attachmentPath}
											{@const url = attachmentUrls[comment.id]}
											{#if !url}
												{(loadAttachmentUrl(comment.id), '')}
												<div class="mt-2 h-32 w-48 bg-muted rounded-lg animate-pulse"></div>
											{:else}
												<button
													class="mt-2 block cursor-pointer"
													onclick={() => openLightbox(url)}
												>
													<img
														src={url}
														alt={comment.attachmentFileName || 'Attachment'}
														class="max-h-48 rounded-lg border hover:opacity-90 transition-opacity"
													/>
												</button>
											{/if}
										{/if}

										<!-- Replies -->
										{#if replies.length > 0}
											<div class="mt-2 space-y-2 border-l-2 border-muted pl-3">
												{#each replies as reply}
													{@const replyAuthor = reply.authorName || userMap.get(reply.userId) || 'User'}
													{@const isOwnReply = currentUserId && reply.userId === currentUserId}
													<div class="flex gap-2">
														<div class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground text-[9px] font-semibold mt-0.5">
															{getInitials(replyAuthor)}
														</div>
														<div class="flex-1 min-w-0">
															<div class="flex items-center gap-2 mb-0.5">
																<p class="text-xs font-medium">{replyAuthor}</p>
																<p class="text-[10px] text-muted-foreground">{timeAgo(reply.createdAt)}</p>
																{#if isOwnReply}
																	<Button variant="ghost" size="icon" class="h-5 w-5 ml-auto" onclick={() => handleDeleteComment(reply.id)}>
																		<Trash2Icon class="h-2.5 w-2.5" />
																	</Button>
																{/if}
															</div>
															<div class="comment-display text-sm">{@html reply.content}</div>
														</div>
													</div>
												{/each}
											</div>
										{/if}

										<!-- Reply editor -->
										{#if replyingToId === comment.id}
											<div class="mt-2 border-l-2 border-primary/30 pl-3">
												<RichEditor
													bind:this={replyEditor}
													placeholder="Write a reply..."
													minHeight="120px"
													showFooter={false}
													{users}
												/>
												<div class="flex gap-2 mt-2">
													<Button size="sm" onclick={() => handleReply(comment.id)} disabled={replyLoading}>
														<SendIcon class="mr-1.5 h-3 w-3" />
														{replyLoading ? 'Replying...' : 'Reply'}
													</Button>
													<Button size="sm" variant="outline" onclick={() => { replyingToId = null; }}>
														Cancel
													</Button>
												</div>
											</div>
										{/if}
									</div>
								</div>
							{/each}
						{/if}
					</div>

					<!-- Add comment form -->
					<div class="flex gap-3">
						<div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground text-xs font-semibold mt-0.5">
							<UserIcon class="h-3.5 w-3.5" />
						</div>
						<div class="flex-1 space-y-2">
							<RichEditor
								bind:this={newCommentEditor}
								placeholder="Write a comment..."
								minHeight="120px"
								showFooter={false}
								{users}
							/>
							<Button size="sm" onclick={handleAddComment} disabled={commentLoading}>
								<SendIcon class="mr-2 h-3.5 w-3.5" />
								{commentLoading ? 'Posting...' : 'Post Comment'}
							</Button>
						</div>
					</div>
				</div>
			</div>

			<!-- Sidebar (right) -->
			<div class="space-y-4">
				<!-- Metadata card -->
				<div class="rounded-lg border border-border/40 bg-card/50 p-4 space-y-3">
					<!-- Status -->
					<div class="flex items-center gap-3">
						<CircleDotIcon class="h-4 w-4 text-muted-foreground shrink-0" />
						<div class="flex-1 min-w-0">
							<p class="text-[11px] text-muted-foreground">Status</p>
							<p class="text-sm font-medium flex items-center gap-1.5">
								<span class="h-1.5 w-1.5 rounded-full {getStatusDotColor(task.status)}"></span>
								{formatStatus(task.status)}
							</p>
						</div>
					</div>

					<Separator />

					<!-- Priority -->
					<div class="flex items-center gap-3">
						<FlagIcon class="h-4 w-4 text-muted-foreground shrink-0" />
						<div class="flex-1 min-w-0">
							<p class="text-[11px] text-muted-foreground">Priority</p>
							<p class="text-sm font-medium flex items-center gap-1.5">
								<span class="h-1.5 w-1.5 rounded-full {getPriorityDotColor(task.priority)}"></span>
								{formatPriority(task.priority || 'medium')}
							</p>
						</div>
					</div>

					<Separator />

					<!-- Due Date -->
					<div class="flex items-center gap-3">
						<CalendarIcon class="h-4 w-4 {overdue ? 'text-red-600' : 'text-muted-foreground'} shrink-0" />
						<div class="flex-1 min-w-0">
							<p class="text-[11px] text-muted-foreground">Due Date</p>
							{#if task.dueDate}
								<p class="text-sm font-medium {overdue ? 'text-red-600' : ''}">{formatDate(task.dueDate)}</p>
								{#if overdue}
									<p class="text-[10px] text-red-500">Overdue</p>
								{/if}
							{:else}
								<p class="text-sm text-muted-foreground">Not set</p>
							{/if}
						</div>
					</div>

					<Separator />

					<!-- Assignee -->
					{#if task.assignedToUserId && userMap.get(task.assignedToUserId)}
						<div class="flex items-center gap-3">
							<UserIcon class="h-4 w-4 text-muted-foreground shrink-0" />
							<div class="flex-1 min-w-0">
								<p class="text-[11px] text-muted-foreground">Assignee</p>
								<p class="text-sm font-medium">{userMap.get(task.assignedToUserId)}</p>
							</div>
						</div>

						<Separator />
					{/if}

					<!-- Created -->
					<div class="flex items-center gap-3">
						<ClockIcon class="h-4 w-4 text-muted-foreground shrink-0" />
						<div class="flex-1 min-w-0">
							<p class="text-[11px] text-muted-foreground">Created</p>
							<p class="text-sm font-medium">{formatDate(task.createdAt)}</p>
							{#if getCreatorName(task.createdByUserId)}
								<p class="text-[10px] text-muted-foreground">by {getCreatorName(task.createdByUserId)}</p>
							{/if}
						</div>
					</div>
				</div>

				<!-- Activity timeline -->
				<div class="rounded-lg border border-border/40 bg-card/50 p-4">
					<div class="flex items-center gap-2 mb-3">
						<HistoryIcon class="h-4 w-4 text-muted-foreground" />
						<h3 class="text-sm font-semibold">Activity ({activities.length})</h3>
					</div>

					{#if activities.length === 0}
						<p class="text-xs text-muted-foreground">No activity recorded yet.</p>
					{:else}
						<div class="relative">
							<div class="absolute left-[11px] top-0 bottom-0 w-px bg-border"></div>
							<div class="space-y-3">
								{#each activities as activity}
									{@const actorName = activity.userName || userMap.get(activity.userId) || activity.userId}
									<div class="flex items-start gap-2.5 relative">
										<div class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full {getActivityIconColor(activity.action)} z-10">
											{#if activity.action === 'created'}
												<PlusIcon class="h-3 w-3" />
											{:else if activity.action === 'commented'}
												<MessageSquareIcon class="h-3 w-3" />
											{:else if activity.action === 'approved'}
												<CheckIcon class="h-3 w-3" />
											{:else if activity.action === 'rejected'}
												<XIcon class="h-3 w-3" />
											{:else if activity.action === 'status_changed'}
												<ArrowRightIcon class="h-3 w-3" />
											{:else if activity.action === 'assigned'}
												<UserCheckIcon class="h-3 w-3" />
											{:else}
												<RefreshCwIcon class="h-3 w-3" />
											{/if}
										</div>
										<div class="flex-1 min-w-0 pt-0.5">
											<p class="text-xs leading-tight">
												<span class="font-medium">{actorName}</span>
												<span class="text-muted-foreground"> {getActivityVerb(activity)}</span>
											</p>
											{#if activity.oldValue || activity.newValue}
												<div class="flex items-center gap-1 mt-0.5 flex-wrap">
													{#if activity.oldValue}
														<Badge variant="outline" class="text-[10px] h-4 px-1 font-normal {getActivityValueColor(activity.field, activity.oldValue)}">{activity.oldValue}</Badge>
													{/if}
													{#if activity.oldValue && activity.newValue}
														<ArrowRightIcon class="h-2.5 w-2.5 text-muted-foreground shrink-0" />
													{/if}
													{#if activity.newValue}
														<Badge variant="secondary" class="text-[10px] h-4 px-1 font-normal {getActivityValueColor(activity.field, activity.newValue)}">{activity.newValue}</Badge>
													{/if}
												</div>
											{/if}
											<p class="text-[10px] text-muted-foreground mt-0.5">{timeAgo(activity.createdAt)}</p>
										</div>
									</div>
								{/each}
							</div>
						</div>
					{/if}
				</div>
			</div>
		</div>
	{:else}
		<div class="flex flex-col items-center justify-center py-12">
			<p class="text-muted-foreground">Task not found</p>
		</div>
	{/if}
</div>

<ImageLightbox
	src={lightboxSrc}
	open={lightboxOpen}
	onClose={() => (lightboxOpen = false)}
/>
