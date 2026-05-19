<script lang="ts">
	import {
		getTaskComments,
		createTaskComment,
		updateTaskComment,
		deleteTaskComment,
		getAttachmentUrl,
		toggleReaction
	} from '$lib/remotes/task-comments.remote';

	const VALID_EMOJIS = ['👍', '🔥', '🎉'] as const;
	import { getTaskActivities } from '$lib/remotes/task-activities.remote';
	import ContactAvatar from '$lib/components/ui/contact-avatar.svelte';
	import { Button } from '$lib/components/ui/button';
	import RichEditor from '$lib/components/RichEditor/RichEditor.svelte';
	import ImageLightbox from '$lib/components/image-lightbox.svelte';
	import { MessageSquare, Pencil, Trash2, Reply, X } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';

	interface Props {
		taskId: string;
		currentUserId: string | undefined;
		tenantSlug: string;
		comments: any[];
		topLevelComments: any[];
		repliesMap: Map<string, any[]>;
		mentionUsers: any[];
		userMap: Map<string, string>;
	}

	let {
		taskId,
		currentUserId,
		tenantSlug,
		comments,
		topLevelComments,
		repliesMap,
		mentionUsers,
		userMap
	}: Props = $props();

	let commentLoading = $state(false);
	let editingCommentId = $state<string | null>(null);
	let editingContent = $state('');
	let editLoading = $state(false);
	let replyingToId = $state<string | null>(null);
	let replyLoading = $state(false);

	let newCommentEditor: RichEditor | null = $state(null);
	let editCommentEditor: RichEditor | null = $state(null);
	let replyEditor: RichEditor | null = $state(null);

	let pendingAttachments = $state<
		{ path: string; mimeType: string; fileName: string; size: number; previewUrl: string }[]
	>([]);
	let uploadingImage = $state(false);
	let attachmentUrls = $state<Record<string, string>>({});
	let lightboxSrc = $state('');
	let lightboxOpen = $state(false);

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
		if (diff < 60) return 'acum';
		if (diff < 3600) return `${Math.floor(diff / 60)}m`;
		if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
		if (diff < 604800) return `${Math.floor(diff / 86400)}z`;
		return d.toLocaleDateString('ro-RO', { day: 'numeric', month: 'short', year: 'numeric' });
	}

	async function uploadImage(file: File) {
		if (file.size > 10 * 1024 * 1024) {
			toast.error('Imaginea trebuie să fie sub 10MB');
			return;
		}
		uploadingImage = true;
		try {
			const formData = new FormData();
			formData.append('file', file);
			formData.append('taskId', taskId);
			const response = await fetch(`/${tenantSlug}/task-comments/upload`, {
				method: 'POST',
				body: formData
			});
			if (!response.ok) {
				const err = await response.json().catch(() => ({ message: 'Upload failed' }));
				throw new Error(err.message || `HTTP ${response.status}`);
			}
			const result = await response.json();
			pendingAttachments = [...pendingAttachments, { ...result, previewUrl: URL.createObjectURL(file) }];
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la upload');
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

	async function loadAttachmentUrl(attachmentId: string) {
		if (attachmentUrls[attachmentId]) return;
		try {
			const result = await getAttachmentUrl(attachmentId).current;
			if (result?.url) attachmentUrls = { ...attachmentUrls, [attachmentId]: result.url };
		} catch {
			/* silent */
		}
	}

	async function handleAddComment() {
		const html = newCommentEditor?.getHTML() ?? '';
		const editorEmpty = newCommentEditor?.isEmpty() ?? true;
		if (editorEmpty && pendingAttachments.length === 0) return;
		commentLoading = true;
		try {
			await createTaskComment({
				taskId,
				content: editorEmpty ? '' : html,
				attachments: pendingAttachments.map((a) => ({
					path: a.path,
					mimeType: a.mimeType,
					fileName: a.fileName,
					fileSize: a.size
				}))
			}).updates(getTaskComments(taskId), getTaskActivities(taskId));
			newCommentEditor?.clear();
			removeAllPendingAttachments();
			toast.success('Comentariu adăugat');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la comentariu');
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
			await updateTaskComment({ commentId, content: html }).updates(
				getTaskComments(taskId),
				getTaskActivities(taskId)
			);
			editingCommentId = null;
			editingContent = '';
			toast.success('Comentariu actualizat');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare');
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
			await createTaskComment({ taskId, content: html, parentCommentId }).updates(
				getTaskComments(taskId),
				getTaskActivities(taskId)
			);
			replyEditor?.clear();
			replyingToId = null;
			toast.success('Răspuns adăugat');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare');
		} finally {
			replyLoading = false;
		}
	}

	async function handleDeleteComment(commentId: string) {
		if (!confirm('Ștergi comentariul?')) return;
		try {
			await deleteTaskComment(commentId).updates(getTaskComments(taskId), getTaskActivities(taskId));
			toast.success('Comentariu șters');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare');
		}
	}

	async function handleToggleReaction(commentId: string, emoji: (typeof VALID_EMOJIS)[number]) {
		try {
			await toggleReaction({ commentId, emoji }).updates(getTaskComments(taskId));
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la reacție');
		}
	}
</script>

<div>
	<div class="mb-4 flex items-center gap-2">
		<MessageSquare class="h-4 w-4 text-muted-foreground" />
		<h4 class="font-semibold">Comentarii ({comments.length})</h4>
	</div>

	<div class="mb-4 space-y-3">
		{#if comments.length === 0}
			<p class="text-sm text-muted-foreground">Niciun comentariu. Fii primul!</p>
		{:else}
			{#each topLevelComments as comment}
				{@const authorName = comment.authorName || userMap.get(comment.userId) || comment.userId}
				{@const isOwnComment = currentUserId && comment.userId === currentUserId}
				{@const replies = repliesMap.get(comment.id) || []}
				<div class="rounded-xl border bg-white p-4 shadow-sm">
					<div class="mb-2 flex items-start gap-3">
						<ContactAvatar
							src={null}
							name={authorName}
							phoneE164={null}
							size="sm"
						/>
						<div class="min-w-0 flex-1">
							<div class="flex flex-wrap items-center gap-2">
								<p class="text-sm font-semibold">{authorName}</p>
								<p class="text-xs text-muted-foreground">{timeAgo(comment.createdAt)}</p>
								{#if comment.updatedAt && new Date(comment.updatedAt).getTime() - new Date(comment.createdAt).getTime() > 1000}
									<span class="text-xs italic text-muted-foreground">(editat)</span>
								{/if}
							</div>
						</div>
						<div class="flex shrink-0 items-center gap-1">
							<button
								type="button"
								aria-label="Răspunde"
								class="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
								onclick={() => {
									replyingToId = replyingToId === comment.id ? null : comment.id;
								}}
							>
								<Reply class="h-3.5 w-3.5" />
							</button>
							{#if isOwnComment && editingCommentId !== comment.id}
								<button
									type="button"
									aria-label="Editează comentariu"
									class="rounded p-1 text-muted-foreground hover:bg-muted"
									onclick={() => {
										editingCommentId = comment.id;
										editingContent = comment.content;
									}}
								>
									<Pencil class="h-3.5 w-3.5" />
								</button>
								<button
									type="button"
									aria-label="Șterge comentariu"
									class="rounded p-1 text-muted-foreground hover:text-destructive"
									onclick={() => handleDeleteComment(comment.id)}
								>
									<Trash2 class="h-3.5 w-3.5" />
								</button>
							{/if}
						</div>
					</div>

					{#if editingCommentId === comment.id}
						<div class="space-y-2">
							<RichEditor
								bind:this={editCommentEditor}
								content={editingContent}
								placeholder="Editează comentariul..."
								minHeight="120px"
								showFooter={false}
								users={mentionUsers}
							/>
							<div class="flex gap-2">
								<Button
									size="sm"
									onclick={() => handleEditComment(comment.id)}
									disabled={editLoading}>{editLoading ? 'Se salvează...' : 'Salvează'}</Button
								>
								<Button
									size="sm"
									variant="outline"
									onclick={() => {
										editingCommentId = null;
										editingContent = '';
									}}>Anulează</Button
								>
							</div>
						</div>
					{:else}
						<div class="comment-display text-sm leading-relaxed">{@html comment.content}</div>
					{/if}

					<div class="mt-2 flex flex-wrap gap-1">
						{#each VALID_EMOJIS as emoji}
							{@const reactionData = comment.reactions?.[emoji]}
							{@const count = reactionData?.count ?? 0}
							{@const mine = reactionData?.mine ?? false}
							<button
								type="button"
								class="reaction-btn {mine ? 'mine' : ''}"
								aria-pressed={mine}
								aria-label="{mine ? 'Elimină' : 'Adaugă'} reacția {emoji}"
								onclick={() => handleToggleReaction(comment.id, emoji)}
							>
								<span>{emoji}</span>
								{#if count > 0}<span class="count">{count}</span>{/if}
							</button>
						{/each}
					</div>

					{#if comment.attachments?.length}
						<div class="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
							{#each comment.attachments as att (att.id)}
								{@const url = attachmentUrls[att.id]}
								{#if !url}
									{(loadAttachmentUrl(att.id), '')}
									<div class="h-[180px] w-full animate-pulse rounded-lg bg-muted"></div>
								{:else}
									<button
										type="button"
										class="block cursor-pointer overflow-hidden rounded-lg border"
										onclick={() => {
											lightboxSrc = url;
											lightboxOpen = true;
										}}
									>
										<img
											src={url}
											alt={att.fileName || 'Atașament'}
											class="h-[180px] w-full object-cover transition-opacity hover:opacity-90"
										/>
									</button>
								{/if}
							{/each}
						</div>
					{/if}

					{#if replies.length > 0}
						<div class="mt-3 ml-6 space-y-2 border-l-2 border-muted pl-3">
							{#each replies as reply}
								{@const replyAuthor = reply.authorName || userMap.get(reply.userId) || reply.userId}
								{@const isOwnReply = currentUserId && reply.userId === currentUserId}
								<div class="py-1.5">
									<div class="mb-1 flex items-center gap-2">
										<ContactAvatar
											src={null}
											name={replyAuthor}
											phoneE164={null}
											size="xs"
										/>
										<p class="text-xs font-medium">{replyAuthor}</p>
										<p class="text-xs text-muted-foreground">{timeAgo(reply.createdAt)}</p>
										{#if isOwnReply}
											<button
												type="button"
												aria-label="Șterge răspuns"
												class="ml-auto rounded p-0.5 text-muted-foreground hover:text-destructive"
												onclick={() => handleDeleteComment(reply.id)}
											>
												<Trash2 class="h-3 w-3" />
											</button>
										{/if}
									</div>
									<div class="comment-display ml-8 text-sm">{@html reply.content}</div>
								</div>
							{/each}
						</div>
					{/if}

					{#if replyingToId === comment.id}
						<div class="mt-3 ml-6 border-l-2 border-primary/30 pl-3">
							<RichEditor
								bind:this={replyEditor}
								placeholder="Scrie un răspuns..."
								minHeight="100px"
								showFooter={false}
								users={mentionUsers}
							/>
							<div class="mt-2 flex gap-2">
								<Button size="sm" onclick={() => handleReply(comment.id)} disabled={replyLoading}
									>{replyLoading ? 'Se trimite...' : 'Trimite'}</Button
								>
								<Button
									size="sm"
									variant="outline"
									onclick={() => {
										replyingToId = null;
									}}>Anulează</Button
								>
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
			placeholder="Adaugă un comentariu... (paste imagine cu Ctrl+V)"
			minHeight="120px"
			showFooter={false}
			onPasteImage={(file) => uploadImage(file)}
			users={mentionUsers}
		/>
		{#if uploadingImage}
			<div class="flex items-center gap-2 text-sm text-muted-foreground">
				<div class="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent"></div>
				Se încarcă imaginea...
			</div>
		{/if}
		{#if pendingAttachments.length > 0}
			<div class="flex flex-wrap gap-2">
				{#each pendingAttachments as attachment, i}
					<div class="relative inline-block">
						<img src={attachment.previewUrl} alt="Preview" class="max-h-32 rounded-lg border" />
						<button
							type="button"
							aria-label="Elimină atașament"
							class="text-destructive-foreground absolute -top-2 -right-2 rounded-full bg-destructive p-0.5 hover:bg-destructive/90"
							onclick={() => removePendingAttachment(i)}
						>
							<X class="h-4 w-4" />
						</button>
					</div>
				{/each}
			</div>
		{/if}
		<Button size="sm" onclick={handleAddComment} disabled={commentLoading || uploadingImage}>
			{commentLoading ? 'Se trimite...' : 'Trimite comentariu'}
		</Button>
	</div>
</div>

<ImageLightbox src={lightboxSrc} open={lightboxOpen} onClose={() => (lightboxOpen = false)} />

<style>
	.reaction-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
		padding: 0.15rem 0.5rem;
		border-radius: 9999px;
		border: 1px solid hsl(var(--border));
		background: transparent;
		font-size: 0.8rem;
		cursor: pointer;
		transition: background 0.15s, border-color 0.15s;
	}
	.reaction-btn:hover {
		background: hsl(var(--muted));
	}
	.reaction-btn.mine {
		border-color: hsl(var(--primary));
		background: hsl(var(--primary) / 0.08);
	}
	.reaction-btn .count {
		font-size: 0.7rem;
		font-weight: 600;
		color: hsl(var(--muted-foreground));
	}
	.reaction-btn.mine .count {
		color: hsl(var(--primary));
	}
	.comment-display :global(a) {
		color: hsl(var(--primary));
		text-decoration: underline;
	}
	.comment-display :global(strong) {
		font-weight: 700;
	}
	.comment-display :global(p) {
		margin-bottom: 0.25rem;
	}
	.comment-display :global(ul),
	.comment-display :global(ol) {
		padding-left: 1.25rem;
		margin-bottom: 0.25rem;
	}
</style>
