<!-- src/lib/components/client-task/client-task-comments.svelte -->
<script lang="ts">
	import {
		getTaskComments,
		createTaskComment,
		getAttachmentUrl,
		toggleReaction
	} from '$lib/remotes/task-comments.remote';
	import { getTaskActivities } from '$lib/remotes/task-activities.remote';
	import { page } from '$app/state';
	import RichEditor from '$lib/components/RichEditor/RichEditor.svelte';
	import { avatarColor, avatarInitials } from '$lib/config/team';
	import type { LightboxImage } from './client-task-lightbox.svelte';
	import RepeatIcon from '@lucide/svelte/icons/repeat';
	import XIcon from '@lucide/svelte/icons/x';
	import { toast } from 'svelte-sonner';
	import { SvelteMap } from 'svelte/reactivity';
	import { onDestroy } from 'svelte';

	const VALID_EMOJIS = ['👍', '🔥', '🎉'] as const;

	type PendingAttachment = {
		path: string;
		mimeType: string;
		fileName: string;
		size: number;
		previewUrl: string;
	};

	type Props = {
		taskId: string;
		onOpenLightbox: (images: LightboxImage[], startIndex: number) => void;
	};

	let { taskId, onOpenLightbox }: Props = $props();

	const tenantSlug = $derived(page.params.tenant ?? '');

	const commentsQuery = $derived(getTaskComments(taskId));
	const allComments = $derived(commentsQuery.current ?? []);

	const topLevelComments = $derived(allComments.filter((c) => !c.parentCommentId));
	const repliesMap = $derived.by(() => {
		const map = new SvelteMap<string, typeof allComments>();
		for (const c of allComments) {
			if (c.parentCommentId) {
				const list = map.get(c.parentCommentId) ?? [];
				list.push(c);
				map.set(c.parentCommentId, list);
			}
		}
		return map;
	});

	let editorRef = $state<RichEditor | null>(null);
	let replyEditorRef = $state<RichEditor | null>(null);
	let pendingAttachments = $state<PendingAttachment[]>([]);
	let replyingToId = $state<string | null>(null);
	let attachmentUrls = $state<Record<string, string>>({});
	let submitting = $state(false);
	let replySubmitting = $state(false);
	let uploadingImage = $state(false);

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
			const result = (await response.json()) as {
				attachmentId: string;
				path: string;
				mimeType: string;
				fileName: string;
				size: number;
			};
			pendingAttachments = [
				...pendingAttachments,
				{
					path: result.path,
					mimeType: result.mimeType,
					fileName: result.fileName,
					size: result.size,
					previewUrl: URL.createObjectURL(file)
				}
			];
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la upload');
		} finally {
			uploadingImage = false;
		}
	}

	function removePendingAttachment(index: number) {
		const att = pendingAttachments[index];
		if (att) URL.revokeObjectURL(att.previewUrl);
		pendingAttachments = pendingAttachments.filter((_, i) => i !== index);
	}

	function removeAllPendingAttachments() {
		for (const a of pendingAttachments) URL.revokeObjectURL(a.previewUrl);
		pendingAttachments = [];
	}

	onDestroy(() => {
		for (const a of pendingAttachments) URL.revokeObjectURL(a.previewUrl);
	});

	async function submitTopLevel() {
		const html = editorRef?.getHTML() ?? '';
		const editorEmpty = editorRef?.isEmpty() ?? true;
		if (editorEmpty && pendingAttachments.length === 0) return;
		if (submitting) return;
		submitting = true;
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
			editorRef?.clear();
			removeAllPendingAttachments();
			toast.success('Comentariu trimis');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare');
		} finally {
			submitting = false;
		}
	}

	async function submitReply(parentCommentId: string) {
		const html = replyEditorRef?.getHTML() ?? '';
		const editorEmpty = replyEditorRef?.isEmpty() ?? true;
		if (editorEmpty) return;
		if (replySubmitting) return;
		replySubmitting = true;
		try {
			await createTaskComment({ taskId, content: html, parentCommentId }).updates(
				getTaskComments(taskId),
				getTaskActivities(taskId)
			);
			replyEditorRef?.clear();
			replyingToId = null;
			toast.success('Răspuns trimis');
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare');
		} finally {
			replySubmitting = false;
		}
	}

	async function react(commentId: string, emoji: (typeof VALID_EMOJIS)[number]) {
		try {
			await toggleReaction({ commentId, emoji }).updates(getTaskComments(taskId));
		} catch (e) {
			toast.error(e instanceof Error ? e.message : 'Eroare la reacție');
		}
	}

	async function loadAttachmentUrl(attachmentId: string): Promise<string> {
		if (attachmentUrls[attachmentId]) return attachmentUrls[attachmentId];
		const result = await getAttachmentUrl(attachmentId).current;
		const url = result?.url ?? '';
		if (url) attachmentUrls = { ...attachmentUrls, [attachmentId]: url };
		return url;
	}

	function fmtDate(d: Date | string): string {
		const date = d instanceof Date ? d : new Date(d);
		return date.toLocaleDateString('ro-RO', {
			day: 'numeric',
			month: 'short',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function isImageMime(mime: string | null | undefined): boolean {
		return !!mime && mime.toLowerCase().startsWith('image/');
	}

	function firstName(authorName: string | null | undefined): string | null {
		if (!authorName) return null;
		const parts = authorName.trim().split(/\s+/);
		return parts[0] ?? null;
	}

	function lastNameOf(authorName: string | null | undefined, authorLastName: string | null | undefined): string | null {
		if (authorLastName) return authorLastName;
		if (!authorName) return null;
		const parts = authorName.trim().split(/\s+/);
		if (parts.length < 2) return null;
		return parts.slice(1).join(' ');
	}

	async function openLightboxForComment(
		comment: (typeof allComments)[number],
		attachmentId: string
	) {
		const imageAttachments = (comment.attachments ?? []).filter((a) => isImageMime(a.mimeType));
		const lightboxImages: LightboxImage[] = await Promise.all(
			imageAttachments.map(async (a) => ({
				url: await loadAttachmentUrl(a.id),
				name: a.fileName ?? undefined
			}))
		);
		const startIndex = imageAttachments.findIndex((a) => a.id === attachmentId);
		onOpenLightbox(lightboxImages, Math.max(0, startIndex));
	}
</script>

<div class="ct-section">
	<div class="ct-section-head mb-4 flex items-center gap-2">
		<span class="grid h-7 w-7 place-items-center rounded-md bg-[#f0f7ff] text-[#1877F2]">
			<svg
				width="14"
				height="14"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2.2"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
			>
				<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
			</svg>
		</span>
		<h3 class="text-[15px] font-bold text-[#0f172a]">
			Comentarii ({topLevelComments.length})
		</h3>
	</div>

	<div class="ct-comments-list flex flex-col">
		{#if topLevelComments.length === 0}
			<p class="py-4 text-[13px] text-[#94a3b8]">Niciun comentariu. Fii primul!</p>
		{:else}
			{#each topLevelComments as c (c.id)}
				{@const replies = repliesMap.get(c.id) ?? []}
				{@const authorDisplay = c.authorName || c.authorEmail || c.userId}
				<div class="ct-comment flex gap-3 border-b border-[#f1f5f9] py-3.5 last:border-b-0">
					<div
						class="ct-comment-av grid h-9 w-9 shrink-0 place-items-center rounded-full text-[12px] font-bold text-white"
						style:background-color={avatarColor(c.authorEmail ?? c.userId)}
					>
						{avatarInitials(
							firstName(c.authorName),
							lastNameOf(c.authorName, c.authorLastName),
							c.authorEmail ?? null
						)}
					</div>
					<div class="ct-comment-body min-w-0 flex-1">
						<div class="ct-comment-head flex items-baseline gap-2">
							<span class="ct-comment-name text-[12.5px] font-bold text-[#0f172a]">
								{authorDisplay}
							</span>
							<span class="ct-comment-time text-[11px] text-[#94a3b8]">
								{fmtDate(c.createdAt)}
							</span>
							<button
								type="button"
								class="ct-comment-reply ml-auto inline-flex items-center gap-1 rounded text-[11px] text-[#94a3b8] hover:text-[#1877F2]"
								onclick={() => (replyingToId = replyingToId === c.id ? null : c.id)}
								aria-label={`Răspunde lui ${authorDisplay}`}
							>
								<RepeatIcon class="h-3 w-3" />
								Răspunde
							</button>
						</div>
						<div
							class="ct-comment-text mt-1 text-[13.5px] leading-[1.65] text-[#334155] [&_p]:m-0 [&_p+p]:mt-2"
						>
							{@html c.content}
						</div>

						{#if c.attachments && c.attachments.length > 0}
							{@const imgAttachments = c.attachments.filter((a) => isImageMime(a.mimeType))}
							{#if imgAttachments.length > 0}
								<div
									class="ct-gallery mt-2 grid gap-2"
									style:grid-template-columns="repeat(auto-fill, 180px)"
								>
									{#each imgAttachments as att (att.id)}
										{#await loadAttachmentUrl(att.id) then resolvedUrl}
											{#if resolvedUrl}
												<button
													type="button"
													class="ct-thumb relative h-[180px] w-[180px] cursor-zoom-in overflow-hidden rounded-[9px] border border-[#e5e9f0]"
													style:background="linear-gradient(135deg, #fafbfd, #e5e9f0)"
													onclick={() => openLightboxForComment(c, att.id)}
													aria-label={`Deschide ${att.fileName ?? 'imaginea'}`}
												>
													<img
														src={resolvedUrl}
														alt={att.fileName ?? ''}
														class="h-full w-full object-cover"
													/>
													{#if att.fileName}
														<div
															class="ct-thumb-name absolute right-0 bottom-0 left-0 truncate px-2 py-1 text-[11px] text-white"
															style:background="linear-gradient(180deg, transparent, rgba(0,0,0,.55))"
														>
															{att.fileName}
														</div>
													{/if}
												</button>
											{:else}
												<div
													class="grid h-[180px] w-[180px] place-items-center rounded-[9px] border border-[#e5e9f0] bg-[#f7f8fa] text-[11px] text-[#94a3b8]"
												>
													Indisponibil
												</div>
											{/if}
										{:catch}
											<div
												class="grid h-[180px] w-[180px] place-items-center rounded-[9px] border border-[#e5e9f0] bg-[#f7f8fa] text-[11px] text-[#94a3b8]"
											>
												Eroare la încărcare
											</div>
										{/await}
									{/each}
								</div>
							{/if}
						{/if}

						<div class="ct-react-bar mt-2 flex flex-wrap items-center gap-1.5">
							{#each VALID_EMOJIS as emoji (emoji)}
								{@const entry = c.reactions?.[emoji]}
								{@const count = entry?.count ?? 0}
								{@const mine = entry?.mine ?? false}
								<button
									type="button"
									class={[
										'ct-react inline-flex items-center gap-1 rounded-full border px-[9px] py-[3px] text-[11.5px] transition-colors',
										mine
											? 'border-[#1877F2] bg-[#f0f7ff] text-[#1877F2]'
											: 'border-[#e5e9f0] bg-white text-[#475569] hover:border-[#1877F2]'
									].join(' ')}
									onclick={() => react(c.id, emoji)}
									aria-label={`React with ${emoji}`}
									aria-pressed={mine}
								>
									<span>{emoji}</span>
									{#if count > 0}
										<span>{count}</span>
									{/if}
								</button>
							{/each}
						</div>

						{#if replies.length > 0}
							<div
								class="ct-replies mt-3 flex flex-col gap-2.5 border-l-2 border-[#e5e9f0] pl-3.5"
							>
								{#each replies as r (r.id)}
									{@const replyAuthor = r.authorName || r.authorEmail || r.userId}
									<div class="flex gap-2.5">
										<div
											class="ct-reply-av grid h-7 w-7 shrink-0 place-items-center rounded-full text-[10px] font-bold text-white"
											style:background-color={avatarColor(r.authorEmail ?? r.userId)}
										>
											{avatarInitials(
												firstName(r.authorName),
												lastNameOf(r.authorName, r.authorLastName),
												r.authorEmail ?? null
											)}
										</div>
										<div class="min-w-0 flex-1">
											<div class="flex items-baseline gap-2">
												<span class="text-[12px] font-bold text-[#0f172a]">
													{replyAuthor}
												</span>
												<span class="text-[11px] text-[#94a3b8]">
													{fmtDate(r.createdAt)}
												</span>
											</div>
											<div class="mt-1 text-[13px] text-[#334155] [&_p]:m-0 [&_p+p]:mt-2">
												{@html r.content}
											</div>
										</div>
									</div>
								{/each}
							</div>
						{/if}

						{#if replyingToId === c.id}
							<div class="mt-3 rounded-md border border-[#e5e9f0] bg-[#f7f8fa] p-2">
								<RichEditor
									bind:this={replyEditorRef}
									placeholder="Scrie un răspuns..."
									minHeight="100px"
									showFooter={false}
								/>
								<div class="mt-1.5 flex justify-end gap-2">
									<button
										type="button"
										class="rounded px-2 py-1 text-[11.5px] text-[#475569] hover:bg-[#f1f5f9]"
										onclick={() => {
											replyingToId = null;
											replyEditorRef?.clear();
										}}
										disabled={replySubmitting}
									>
										Anulează
									</button>
									<button
										type="button"
										class="rounded bg-[#1877F2] px-3 py-1 text-[11.5px] font-medium text-white hover:bg-[#1668d8] disabled:opacity-60"
										onclick={() => submitReply(c.id)}
										disabled={replySubmitting}
									>
										{replySubmitting ? 'Se trimite...' : 'Trimite'}
									</button>
								</div>
							</div>
						{/if}
					</div>
				</div>
			{/each}
		{/if}
	</div>

	<!-- Composer -->
	<div class="ct-composer mt-4">
		<RichEditor
			bind:this={editorRef}
			placeholder="Adaugă un comentariu... (paste imagine cu Ctrl+V)"
			minHeight="120px"
			showFooter={false}
			onPasteImage={(file) => uploadImage(file)}
		/>
		{#if uploadingImage}
			<div class="mt-2 flex items-center gap-2 text-[12px] text-[#94a3b8]">
				<div
					class="h-3 w-3 animate-spin rounded-full border-2 border-[#1877F2] border-t-transparent"
				></div>
				Se încarcă imaginea...
			</div>
		{/if}
		{#if pendingAttachments.length > 0}
			<div class="mt-2 flex flex-wrap gap-2">
				{#each pendingAttachments as p, i (p.path)}
					<div class="relative h-16 w-16 overflow-hidden rounded-md border border-[#e5e9f0]">
						<img src={p.previewUrl} alt={p.fileName} class="h-full w-full object-cover" />
						<button
							type="button"
							class="absolute top-0.5 right-0.5 grid h-4 w-4 place-items-center rounded-full bg-black/60 text-[10px] text-white"
							onclick={() => removePendingAttachment(i)}
							aria-label="Elimină imaginea"
						>
							<XIcon class="h-2.5 w-2.5" />
						</button>
					</div>
				{/each}
			</div>
		{/if}
		<div class="mt-2 flex justify-end">
			<button
				type="button"
				class="rounded-md bg-[#1877F2] px-4 py-1.5 text-[12.5px] font-semibold text-white hover:bg-[#1668d8] disabled:opacity-60"
				onclick={submitTopLevel}
				disabled={submitting || uploadingImage}
			>
				{submitting ? 'Se trimite...' : 'Trimite comentariu'}
			</button>
		</div>
	</div>
</div>
