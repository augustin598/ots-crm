<script lang="ts">
	import { getTaskComments, createTaskComment, updateTaskComment, deleteTaskComment, getCommentAttachmentUrl } from '$lib/remotes/task-comments.remote';
	import { getTaskMaterials, getAvailableMaterialsForTask, linkMaterialToTask, unlinkMaterialFromTask } from '$lib/remotes/task-materials.remote';
	import { getProjects } from '$lib/remotes/projects.remote';
	import { getTenantUsers, getClientUsers } from '$lib/remotes/users.remote';
	import { getClients } from '$lib/remotes/clients.remote';
	import { approveTask, rejectTask, getTasks, getTask } from '$lib/remotes/tasks.remote';
	import { getTaskActivities } from '$lib/remotes/task-activities.remote';
	import { getTaskFilters } from '$lib/components/task-filters-context';
	import { goto } from '$app/navigation';
	import { Dialog, DialogContent, DialogHeader, DialogTitle } from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Input } from '$lib/components/ui/input';
	import { Separator } from '$lib/components/ui/separator';
	import RichEditor from '$lib/components/RichEditor/RichEditor.svelte';
	import * as Popover from '$lib/components/ui/popover';
	import EditTaskDialog from '$lib/components/edit-task-dialog.svelte';
	import ImageLightbox from '$lib/components/image-lightbox.svelte';
	import { formatStatus, getStatusBadgeVariant, formatDate, getPriorityColor, getPriorityDotColor, formatPriority, getActivityValueColor } from '$lib/components/task-kanban-utils';
	import { Calendar, User, Building, MessageSquare, Edit, Check, X, Pencil, Trash2, History, Plus, ArrowRight, UserCheck, RefreshCw, Link, Unlink, Image, Video, FileText, Type, ExternalLink, Reply } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import type { Task } from '$lib/server/db/schema';

	interface Props {
		task: Task | null;
		open: boolean;
		onOpenChange: (open: boolean) => void;
		tenantSlug?: string;
		currentUserId?: string;
		additionalQueriesToUpdate?: any[];
	}

	let { task, open, onOpenChange, tenantSlug = '', currentUserId, additionalQueriesToUpdate = [] }: Props = $props();

	const filterParams = getTaskFilters();

	let isEditOpen = $state(false);
	let newComment = $state('');
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

	// Image paste/attachment state (supports multiple)
	let pendingAttachments = $state<{ path: string; mimeType: string; fileName: string; size: number; previewUrl: string }[]>([]);
	let uploadingImage = $state(false);

	// Lightbox state
	let lightboxSrc = $state('');
	let lightboxOpen = $state(false);

	// Cache for attachment URLs (commentId -> url)
	let attachmentUrls = $state<Record<string, string>>({});

	const commentsQuery = $derived(task ? getTaskComments(task.id) : null);
	const comments = $derived(commentsQuery?.current || []);

	const activitiesQuery = $derived(task ? getTaskActivities(task.id) : null);
	const activities = $derived(activitiesQuery?.current || []);

	const materialsQuery = $derived(task ? getTaskMaterials(task.id) : null);
	const taskMaterials = $derived(materialsQuery?.current || []);

	let materialPickerOpen = $state(false);
	let materialSearchTerm = $state('');
	let linkingMaterialId = $state<string | null>(null);

	const availableMaterialsQuery = $derived(
		task && materialPickerOpen ? getAvailableMaterialsForTask(task.id) : null
	);
	const availableMaterials = $derived(availableMaterialsQuery?.current || []);
	const filteredAvailableMaterials = $derived(
		materialSearchTerm.trim()
			? availableMaterials.filter((m: any) =>
					m.title.toLowerCase().includes(materialSearchTerm.toLowerCase())
				)
			: availableMaterials
	);

	const MATERIAL_TYPE_ICONS: Record<string, typeof Image> = {
		image: Image,
		video: Video,
		document: FileText,
		text: Type,
		url: ExternalLink
	};

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

	// Get users associated with the task's client for @mentions
	const clientUsersQuery = $derived(task?.clientId ? getClientUsers(task.clientId) : null);
	const mentionUsers = $derived(clientUsersQuery?.current || users);

	// Thread comments: top-level + replies grouped by parent
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

	const projectsQuery = getProjects(undefined);
	const projects = $derived(projectsQuery.current || []);
	const projectMap = $derived(new Map(projects.map((p) => [p.id, p.name])));

	const clientsQuery = getClients();
	const clientsList = $derived(clientsQuery.current || []);
	const clientMap = $derived(new Map(clientsList.map((c: any) => [c.id, c.name])));


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

	function getInitials(name: string): string {
		return name
			.split(' ')
			.map((n) => n[0])
			.join('')
			.toUpperCase()
			.slice(0, 2);
	}

	async function handlePaste(e: ClipboardEvent) {
		const items = e.clipboardData?.items;
		if (!items || !task) return;

		for (const item of items) {
			if (item.type.startsWith('image/')) {
				e.preventDefault();
				const file = item.getAsFile();
				if (!file) return;
				await uploadImage(file);
				return;
			}
		}
	}

	async function uploadImage(file: File) {
		if (!task) return;
		if (file.size > 10 * 1024 * 1024) {
			toast.error('Image must be under 10MB');
			return;
		}

		uploadingImage = true;
		try {
			const formData = new FormData();
			formData.append('file', file);
			formData.append('taskId', task.id);

			const response = await fetch(`/${tenantSlug}/task-comments/upload`, {
				method: 'POST',
				body: formData
			});

			if (!response.ok) {
				const err = await response.json().catch(() => ({ message: 'Upload failed' }));
				throw new Error(err.message || `HTTP ${response.status}`);
			}

			const result = await response.json();
			const previewUrl = URL.createObjectURL(file);
			pendingAttachments = [...pendingAttachments, { ...result, previewUrl }];
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Failed to upload image');
		} finally {
			uploadingImage = false;
		}
	}

	function removePendingAttachment(index: number) {
		URL.revokeObjectURL(pendingAttachments[index].previewUrl);
		pendingAttachments = pendingAttachments.filter((_, i) => i !== index);
	}

	function removeAllPendingAttachments() {
		for (const a of pendingAttachments) URL.revokeObjectURL(a.previewUrl);
		pendingAttachments = [];
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

	async function handleAddComment() {
		const html = newCommentEditor?.getHTML() ?? '';
		const text = newCommentEditor?.getText() ?? '';
		const editorEmpty = newCommentEditor?.isEmpty() ?? true;

		if ((editorEmpty && pendingAttachments.length === 0) || !task) return;

		commentLoading = true;
		try {
			const firstAttachment = pendingAttachments[0] || null;
			const commentContent = editorEmpty ? '' : html;
			// First comment: text + first image (if any)
			await createTaskComment({
				taskId: task.id,
				content: commentContent,
				...(firstAttachment ? {
					attachmentPath: firstAttachment.path,
					attachmentMimeType: firstAttachment.mimeType,
					attachmentFileName: firstAttachment.fileName,
					attachmentFileSize: firstAttachment.size
				} : {})
			}).updates(getTaskComments(task.id), getTaskActivities(task.id));

			// Additional images as separate comments
			for (let i = 1; i < pendingAttachments.length; i++) {
				const att = pendingAttachments[i];
				await createTaskComment({
					taskId: task.id,
					content: '',
					attachmentPath: att.path,
					attachmentMimeType: att.mimeType,
					attachmentFileName: att.fileName,
					attachmentFileSize: att.size
				}).updates(getTaskComments(task.id), getTaskActivities(task.id));
			}

			newCommentEditor?.clear();
			newComment = '';
			removeAllPendingAttachments();
			toast.success('Comment added');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Failed to add comment');
		} finally {
			commentLoading = false;
		}
	}

	async function handleEditComment(commentId: string) {
		const html = editCommentEditor?.getHTML() ?? '';
		const isEmpty = editCommentEditor?.isEmpty() ?? true;
		if (isEmpty || !task) return;
		editLoading = true;
		try {
			await updateTaskComment({
				commentId,
				content: html
			}).updates(getTaskComments(task.id), getTaskActivities(task.id));
			editingCommentId = null;
			editingContent = '';
			toast.success('Comment updated');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Failed to update comment');
		} finally {
			editLoading = false;
		}
	}

	async function handleReply(parentCommentId: string) {
		const html = replyEditor?.getHTML() ?? '';
		const isEmpty = replyEditor?.isEmpty() ?? true;
		if (isEmpty || !task) return;

		replyLoading = true;
		try {
			await createTaskComment({
				taskId: task.id,
				content: html,
				parentCommentId
			}).updates(getTaskComments(task.id), getTaskActivities(task.id));
			replyEditor?.clear();
			replyingToId = null;
			toast.success('Reply added');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Failed to add reply');
		} finally {
			replyLoading = false;
		}
	}

	async function handleDeleteComment(commentId: string) {
		if (!task || !confirm('Delete this comment?')) return;
		try {
			await deleteTaskComment(commentId).updates(getTaskComments(task.id), getTaskActivities(task.id));
			toast.success('Comment deleted');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Failed to delete comment');
		}
	}

	async function handleApprove() {
		if (!task) return;
		approvalLoading = true;
		try {
			await approveTask({ taskId: task.id }).updates(getTasks(filterParams || {}), getTask(task.id), ...additionalQueriesToUpdate);
			toast.success('Task approved');
			onOpenChange(false);
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
			await rejectTask(task.id).updates(getTasks(filterParams || {}), getTask(task.id), ...additionalQueriesToUpdate);
			toast.success('Task rejected');
			onOpenChange(false);
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Failed to reject task');
		} finally {
			approvalLoading = false;
		}
	}

	async function handleLinkMaterial(materialId: string) {
		if (!task) return;
		linkingMaterialId = materialId;
		try {
			await linkMaterialToTask({ taskId: task.id, materialId })
				.updates(getTaskMaterials(task.id), getAvailableMaterialsForTask(task.id));
			toast.success('Material adăugat');
		} catch (e: any) {
			toast.error(e?.message || 'Eroare la adăugare material');
		} finally {
			linkingMaterialId = null;
		}
	}

	async function handleUnlinkMaterial(materialId: string) {
		if (!task || !confirm('Elimină legătura cu acest material?')) return;
		try {
			await unlinkMaterialFromTask({ taskId: task.id, materialId })
				.updates(getTaskMaterials(task.id), getAvailableMaterialsForTask(task.id));
			toast.success('Material eliminat');
		} catch (e: any) {
			toast.error(e?.message || 'Eroare la eliminare');
		}
	}
</script>

{#if task}
	<Dialog bind:open onOpenChange={onOpenChange}>
		<DialogContent class="sm:max-w-5xl max-h-[90vh] overflow-y-auto" showCloseButton={false}>
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
						<Badge class={getPriorityColor(task.priority || 'medium')}>
							{formatPriority(task.priority || 'medium')}
						</Badge>
						<Badge variant={getStatusBadgeVariant(task.status)}>{formatStatus(task.status || 'todo')}</Badge>
					</div>
				</div>
				<div class="flex items-center gap-2">
					{#if task.status === 'pending-approval'}
						<Button
							variant="default"
							size="sm"
							onclick={handleApprove}
							disabled={approvalLoading}
						>
							<Check class="mr-2 h-4 w-4" />
							Approve
						</Button>
						<Button
							variant="destructive"
							size="sm"
							onclick={handleReject}
							disabled={approvalLoading}
						>
							<X class="mr-2 h-4 w-4" />
							Reject
						</Button>
					{/if}
					<Button variant="outline" size="sm" onclick={() => (isEditOpen = true)}>
						<Edit class="mr-2 h-4 w-4" />
						Edit
					</Button>
					<Button variant="ghost" size="sm" onclick={() => onOpenChange(false)}>
						<X class="h-4 w-4" />
					</Button>
				</div>
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
					{#if task.clientId}
						<div class="flex items-center gap-3">
							<div class="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-500/10">
								<Building class="h-5 w-5 text-orange-600" />
							</div>
							<div>
								<p class="text-sm text-muted-foreground">Client</p>
								<p class="font-medium">{clientMap.get(task.clientId) || '-'}</p>
							</div>
						</div>
					{/if}

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
								<p class="font-medium">{formatDate(task.dueDate)}</p>
							</div>
						</div>
					{/if}
				</div>

				<Separator />

				<!-- Materials section -->
				<div>
					<div class="flex items-center justify-between mb-4">
						<div class="flex items-center gap-2">
							<Link class="h-4 w-4 text-muted-foreground" />
							<h4 class="font-semibold">Materiale ({taskMaterials.length})</h4>
						</div>
						<Popover.Root bind:open={materialPickerOpen}>
							<Popover.Trigger>
								{#snippet child({ props })}
									<Button {...props} variant="outline" size="sm">
										<Plus class="h-3.5 w-3.5 mr-1" />
										Adaugă
									</Button>
								{/snippet}
							</Popover.Trigger>
							<Popover.Content class="w-80 p-0" align="end">
								<div class="p-3 border-b">
									<Input
										type="text"
										placeholder="Caută materiale..."
										bind:value={materialSearchTerm}
										class="h-8 text-sm"
									/>
								</div>
								<div class="max-h-[200px] overflow-y-auto">
									{#if filteredAvailableMaterials.length === 0}
										<p class="text-sm text-muted-foreground p-3">
											{materialSearchTerm ? 'Niciun material găsit.' : 'Nu există materiale disponibile.'}
										</p>
									{:else}
										{#each filteredAvailableMaterials as mat}
											{@const Icon = MATERIAL_TYPE_ICONS[mat.type] || FileText}
											<button
												class="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-muted text-sm transition-colors disabled:opacity-50"
												onclick={() => handleLinkMaterial(mat.id)}
												disabled={linkingMaterialId === mat.id}
											>
												<Icon class="h-4 w-4 shrink-0 text-muted-foreground" />
												<span class="truncate flex-1">{mat.title}</span>
												<Badge variant="outline" class="text-xs shrink-0">{mat.type}</Badge>
											</button>
										{/each}
									{/if}
								</div>
							</Popover.Content>
						</Popover.Root>
					</div>

					{#if taskMaterials.length === 0}
						<p class="text-sm text-muted-foreground">Niciun material asociat.</p>
					{:else}
						<div class="grid gap-2 sm:grid-cols-2">
							{#each taskMaterials as mat}
								{@const Icon = MATERIAL_TYPE_ICONS[mat.materialType] || FileText}
								<div class="flex items-center gap-3 p-3 border rounded-lg group">
									<div class="flex h-9 w-9 items-center justify-center rounded-lg bg-muted shrink-0">
										<Icon class="h-4 w-4 text-muted-foreground" />
									</div>
									<div class="flex-1 min-w-0">
										{#if mat.materialExternalUrl}
											<a
												href={mat.materialExternalUrl}
												target="_blank"
												rel="noopener noreferrer"
												class="text-sm font-medium truncate block hover:text-primary"
											>
												{mat.materialTitle}
											</a>
										{:else}
											<p class="text-sm font-medium truncate">{mat.materialTitle}</p>
										{/if}
										<p class="text-xs text-muted-foreground capitalize">{mat.materialCategory.replace(/-/g, ' ')} · {mat.materialType}</p>
									</div>
									<Button
										variant="ghost"
										size="icon"
										class="h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
										onclick={() => handleUnlinkMaterial(mat.materialId)}
									>
										<Unlink class="h-3.5 w-3.5" />
									</Button>
								</div>
							{/each}
						</div>
					{/if}
				</div>

				<Separator />

				<div>
					<div class="flex items-center gap-2 mb-4">
						<MessageSquare class="h-4 w-4 text-muted-foreground" />
						<h4 class="font-semibold">Comments ({comments.length})</h4>
					</div>

					<div class="space-y-3 mb-4">
						{#if comments.length === 0}
							<p class="text-sm text-muted-foreground">No comments yet. Be the first to comment!</p>
						{:else}
							{#each topLevelComments as comment}
								{@const authorName = comment.authorName || userMap.get(comment.userId) || comment.userId}
								{@const isOwnComment = currentUserId && comment.userId === currentUserId}
								{@const replies = repliesMap.get(comment.id) || []}
								<div class="border rounded-lg p-3">
									<div class="flex items-center gap-2 mb-1.5">
										<div class="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-semibold">
											{getInitials(authorName)}
										</div>
										<div class="flex-1 min-w-0">
											<p class="font-medium text-sm">{authorName}</p>
											<p class="text-xs text-muted-foreground">
												{new Date(comment.createdAt).toLocaleString()}
												{#if comment.updatedAt && new Date(comment.updatedAt).getTime() - new Date(comment.createdAt).getTime() > 1000}
													<span class="italic">(edited)</span>
												{/if}
											</p>
										</div>
										<div class="flex items-center gap-1">
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
												minHeight="80px"
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
										<div class="comment-display text-sm leading-relaxed">{@html comment.content}</div>
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
										<div class="mt-3 ml-6 space-y-2 border-l-2 border-muted pl-3">
											{#each replies as reply}
												{@const replyAuthor = reply.authorName || userMap.get(reply.userId) || reply.userId}
												{@const isOwnReply = currentUserId && reply.userId === currentUserId}
												<div class="py-1.5">
													<div class="flex items-center gap-2 mb-1">
														<div class="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-muted-foreground text-xs font-semibold">
															{getInitials(replyAuthor)}
														</div>
														<p class="font-medium text-xs">{replyAuthor}</p>
														<p class="text-xs text-muted-foreground">{new Date(reply.createdAt).toLocaleString()}</p>
														{#if isOwnReply}
															<Button variant="ghost" size="icon" class="h-5 w-5 ml-auto" onclick={() => handleDeleteComment(reply.id)}>
																<Trash2 class="h-2.5 w-2.5" />
															</Button>
														{/if}
													</div>
													<div class="comment-display text-sm ml-8">{@html reply.content}</div>
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
												minHeight="60px"
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

					<div class="space-y-2">
						<RichEditor
							bind:this={newCommentEditor}
							placeholder="Add a comment... (paste an image with Ctrl+V)"
							minHeight="80px"
							showFooter={false}
							onPasteImage={(file) => uploadImage(file)}
							users={mentionUsers}
						/>
						{#if uploadingImage}
							<div class="flex items-center gap-2 text-sm text-muted-foreground">
								<div class="h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
								Uploading image...
							</div>
						{/if}
						{#if pendingAttachments.length > 0}
							<div class="flex flex-wrap gap-2">
								{#each pendingAttachments as attachment, i}
									<div class="relative inline-block">
										<img
											src={attachment.previewUrl}
											alt="Preview"
											class="max-h-32 rounded-lg border"
										/>
										<button
											class="absolute -top-2 -right-2 rounded-full bg-destructive text-destructive-foreground p-0.5 hover:bg-destructive/90"
											onclick={() => removePendingAttachment(i)}
										>
											<X class="h-4 w-4" />
										</button>
									</div>
								{/each}
							</div>
						{/if}
						<Button size="sm" onclick={handleAddComment} disabled={commentLoading || uploadingImage}>
							{commentLoading ? 'Posting...' : 'Post Comment'}
						</Button>
					</div>
				</div>

				<Separator />

				<div>
					<div class="flex items-center gap-2 mb-4">
						<History class="h-4 w-4 text-muted-foreground" />
						<h4 class="font-semibold">Activity ({activities.length})</h4>
					</div>

					{#if activities.length === 0}
						<p class="text-sm text-muted-foreground">No activity recorded yet.</p>
					{:else}
						<div class="relative max-h-[350px] overflow-y-auto">
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
				</div>
			</div>
		</DialogContent>
	</Dialog>

	{#if task}
		<EditTaskDialog
			task={task}
			open={isEditOpen}
			onOpenChange={(open) => (isEditOpen = open)}
			onSuccess={() => {
				// Task data refreshed via .updates() in EditTaskDialog
			}}
			{additionalQueriesToUpdate}
		/>
	{/if}

{/if}

<ImageLightbox
	src={lightboxSrc}
	open={lightboxOpen}
	onClose={() => (lightboxOpen = false)}
/>
