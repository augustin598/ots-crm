<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button';
	import { Card } from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Select, SelectContent, SelectItem, SelectTrigger } from '$lib/components/ui/select';
	import RichEditor from '$lib/components/RichEditor/RichEditor.svelte';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import SaveIcon from '@lucide/svelte/icons/save';
	import SendIcon from '@lucide/svelte/icons/send';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import ImageIcon from '@lucide/svelte/icons/image';
	import XIcon from '@lucide/svelte/icons/x';

	const tenantSlug = $derived(page.params.tenant);
	const siteId = $derived(page.params.siteId);
	const postIdStr = $derived(page.params.postId);
	const apiPost = $derived(`/${tenantSlug}/api/wordpress/sites/${siteId}/posts/${postIdStr}`);

	let title = $state('');
	let slug = $state('');
	let excerpt = $state('');
	let status = $state<'draft' | 'publish' | 'future' | 'pending' | 'private'>('draft');
	let publishedAt = $state('');
	let contentHtml = $state('');
	let link = $state('');
	let loading = $state(true);
	let saving = $state(false);
	let deleting = $state(false);
	let initialContent = $state<string>('');

	let featuredFile = $state<File | null>(null);
	let featuredPreview = $state<string | null>(null);
	let featuredMediaId = $state<number | null>(null);
	let featuredUrlFromServer = $state<string | null>(null);
	let featuredRemoved = $state(false);

	let editorRef = $state<RichEditor | null>(null);

	function handleEditorUpdate(data: { html: string }) {
		contentHtml = data.html;
	}

	async function onImageUpload(file: File): Promise<string> {
		return await fileToDataUrl(file);
	}

	function onPasteImage(file: File) {
		fileToDataUrl(file).then((dataUrl) => {
			editorRef?.setContent(
				`${editorRef?.getHTML() ?? ''}<p><img src="${dataUrl}" /></p>`
			);
		});
	}

	function fileToDataUrl(file: File): Promise<string> {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(String(reader.result));
			reader.onerror = () => reject(reader.error);
			reader.readAsDataURL(file);
		});
	}

	async function pickFeatured(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		featuredFile = file;
		featuredPreview = await fileToDataUrl(file);
		featuredRemoved = false;
	}

	function clearFeatured() {
		featuredFile = null;
		featuredPreview = null;
		featuredMediaId = null;
		featuredUrlFromServer = null;
		featuredRemoved = true;
	}

	async function uploadFeaturedIfNeeded(): Promise<number | null | undefined> {
		// If user hit remove, send featuredMediaId=null explicitly to clear it.
		if (featuredRemoved && !featuredFile) return null;
		if (!featuredFile || !featuredPreview) return featuredMediaId ?? undefined;

		const match = featuredPreview.match(/^data:([^;]+);base64,(.+)$/);
		if (!match) {
			toast.error('Imaginea selectată nu a putut fi citită');
			return undefined;
		}
		const [, mime, dataBase64] = match;
		const res = await fetch(`/${tenantSlug}/api/wordpress/sites/${siteId}/media`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ filename: featuredFile.name, mimeType: mime, dataBase64 })
		});
		const body = (await res.json().catch(() => ({}))) as { id?: number; error?: string };
		if (!res.ok || !body.id) {
			toast.error(`Upload featured image a eșuat: ${body.error ?? 'necunoscut'}`);
			return undefined;
		}
		featuredMediaId = body.id;
		return body.id;
	}

	async function loadPost() {
		loading = true;
		try {
			const res = await fetch(apiPost);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = (await res.json()) as {
				post: {
					title: string;
					slug: string;
					excerpt: string;
					contentHtml: string;
					status: string;
					featuredMediaId: number | null;
					featuredMediaUrl: string | null;
					link: string;
					publishedAt: string | null;
				};
			};
			title = data.post.title;
			slug = data.post.slug;
			excerpt = data.post.excerpt;
			contentHtml = data.post.contentHtml;
			initialContent = data.post.contentHtml;
			status = (['draft', 'publish', 'future', 'pending', 'private'].includes(data.post.status)
				? data.post.status
				: 'draft') as typeof status;
			featuredMediaId = data.post.featuredMediaId;
			featuredUrlFromServer = data.post.featuredMediaUrl;
			link = data.post.link;
			if (data.post.publishedAt) {
				// WP returns ISO-8601 UTC; HTML datetime-local wants naive local.
				const d = new Date(data.post.publishedAt);
				publishedAt = d.toISOString().slice(0, 16);
			}
		} catch (err) {
			toast.error('Nu s-a putut încărca postarea');
			console.error(err);
		} finally {
			loading = false;
		}
	}

	onMount(loadPost);

	async function save(nextStatus: typeof status) {
		if (!title.trim()) {
			toast.error('Completează titlul');
			return;
		}
		if (!contentHtml || contentHtml === '<p></p>') {
			toast.error('Adaugă conținut în postare');
			return;
		}
		if (nextStatus === 'future' && !publishedAt) {
			toast.error('Setează data de publicare programată');
			return;
		}

		saving = true;
		try {
			const featuredId = await uploadFeaturedIfNeeded();
			// If uploadFeaturedIfNeeded returned undefined and there was a file, it errored — bail.
			if (featuredFile && featuredId === undefined) return;

			const payload: Record<string, unknown> = {
				title: title.trim(),
				slug: slug.trim() || undefined,
				excerpt: excerpt.trim() || undefined,
				contentHtml,
				status: nextStatus,
				publishedAt:
					nextStatus === 'future' && publishedAt
						? new Date(publishedAt).toISOString()
						: undefined
			};
			if (featuredId !== undefined) {
				payload.featuredMediaId = featuredId;
			}

			const res = await fetch(apiPost, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload)
			});
			const body = (await res.json().catch(() => ({}))) as {
				post?: { id: number };
				error?: string;
				uploadedAttachments?: number;
			};
			if (!res.ok) {
				toast.error(body.error || 'Salvarea a eșuat');
				return;
			}
			const label = nextStatus === 'publish' ? 'publicată' : nextStatus === 'future' ? 'programată' : 'salvată';
			toast.success(
				`Postare ${label}${body.uploadedAttachments ? ` (${body.uploadedAttachments} imagini noi)` : ''}`
			);
			featuredFile = null;
			featuredPreview = null;
			await loadPost();
		} catch (err) {
			toast.error('Eroare de rețea');
			console.error(err);
		} finally {
			saving = false;
		}
	}

	async function deletePost() {
		if (!confirm('Trimiți postarea la coș? Pe WordPress rămâne în trash și poate fi restaurată.')) return;
		deleting = true;
		try {
			const res = await fetch(apiPost, { method: 'DELETE' });
			if (!res.ok) {
				const body = (await res.json().catch(() => ({}))) as { error?: string };
				toast.error(body.error || 'Ștergerea a eșuat');
				return;
			}
			toast.success('Trimis la coș');
			goto(`/${tenantSlug}/wordpress/${siteId}/posts`);
		} catch (err) {
			toast.error('Eroare de rețea');
			console.error(err);
		} finally {
			deleting = false;
		}
	}
</script>

<svelte:head>
	<title>Editare postare — OTS CRM</title>
</svelte:head>

<div class="flex h-full flex-col gap-4 p-6">
	<div class="flex items-center gap-2">
		<a href="/{tenantSlug}/wordpress/{siteId}/posts">
			<Button variant="ghost" size="sm">
				<ArrowLeftIcon class="mr-2 size-4" />
				Înapoi la postări
			</Button>
		</a>
	</div>

	<div class="flex items-center justify-between gap-2">
		<h1 class="text-2xl font-semibold tracking-tight">Editare postare</h1>
		<div class="flex items-center gap-2">
			{#if link && status === 'publish'}
				<a href={link} target="_blank" rel="noopener noreferrer">
					<Button variant="outline">
						<ExternalLinkIcon class="mr-2 size-4" />
						Vezi pe site
					</Button>
				</a>
			{/if}
			<Button variant="outline" disabled={saving || deleting} onclick={() => save('draft')}>
				<SaveIcon class="mr-2 size-4" />
				Salvează ca ciornă
			</Button>
			{#if status === 'future'}
				<Button disabled={saving || deleting} onclick={() => save('future')}>
					<SendIcon class="mr-2 size-4" />
					Programează
				</Button>
			{:else}
				<Button disabled={saving || deleting} onclick={() => save('publish')}>
					<SendIcon class="mr-2 size-4" />
					{status === 'publish' ? 'Actualizează' : 'Publică'}
				</Button>
			{/if}
			<Button variant="outline" disabled={saving || deleting} onclick={deletePost} title="Trimite la coș">
				<Trash2Icon class="size-4 text-destructive" />
			</Button>
		</div>
	</div>

	{#if loading}
		<div class="py-8 text-center text-sm text-muted-foreground">Se încarcă…</div>
	{:else}
		<div class="grid gap-4 md:grid-cols-[2fr_1fr]">
			<Card class="flex flex-col gap-3 p-4">
				<div class="flex flex-col gap-1">
					<Label for="post-title">Titlu</Label>
					<Input
						id="post-title"
						bind:value={title}
						placeholder="Titlul postării"
						class="text-lg font-semibold"
						autocomplete="off"
					/>
				</div>

				<div class="flex flex-col gap-1">
					<Label for="post-slug">Slug</Label>
					<Input
						id="post-slug"
						bind:value={slug}
						placeholder="titlul-postarii"
						autocomplete="off"
					/>
				</div>

				<div class="flex flex-col gap-1">
					<Label>Conținut</Label>
					<RichEditor
						bind:this={editorRef}
						content={initialContent}
						placeholder="Scrie postarea..."
						onUpdate={handleEditorUpdate}
						{onImageUpload}
						{onPasteImage}
						minHeight="400px"
					/>
				</div>

				<div class="flex flex-col gap-1">
					<Label for="post-excerpt">Rezumat (opțional)</Label>
					<Textarea
						id="post-excerpt"
						bind:value={excerpt}
						placeholder="Scurt rezumat"
						rows={3}
					/>
				</div>
			</Card>

			<Card class="flex flex-col gap-4 p-4 h-fit sticky top-4">
				<div>
					<h3 class="mb-2 text-sm font-semibold">Status</h3>
					<Select type="single" bind:value={status}>
						<SelectTrigger>
							{status === 'draft'
								? 'Ciornă'
								: status === 'publish'
									? 'Publicat'
									: status === 'future'
										? 'Programat'
										: status === 'pending'
											? 'În așteptare'
											: 'Privat'}
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="draft">Ciornă</SelectItem>
							<SelectItem value="publish">Publicat</SelectItem>
							<SelectItem value="future">Programat</SelectItem>
							<SelectItem value="pending">În așteptare</SelectItem>
							<SelectItem value="private">Privat</SelectItem>
						</SelectContent>
					</Select>
					{#if status === 'future'}
						<div class="mt-2 flex flex-col gap-1">
							<Label for="post-publish-at">Publică la</Label>
							<Input
								id="post-publish-at"
								type="datetime-local"
								bind:value={publishedAt}
							/>
						</div>
					{/if}
				</div>

				<div>
					<h3 class="mb-2 text-sm font-semibold">Imagine reprezentativă</h3>
					{#if featuredPreview}
						<div class="relative">
							<img
								src={featuredPreview}
								alt="Featured preview"
								class="w-full rounded-lg border object-cover aspect-video"
							/>
							<Button
								variant="destructive"
								size="icon"
								class="absolute top-2 right-2 h-7 w-7"
								onclick={clearFeatured}
							>
								<XIcon class="size-4" />
							</Button>
						</div>
					{:else if featuredUrlFromServer && !featuredRemoved}
						<div class="relative">
							<img
								src={featuredUrlFromServer}
								alt="Current featured"
								class="w-full rounded-lg border object-cover aspect-video"
							/>
							<Button
								variant="destructive"
								size="icon"
								class="absolute top-2 right-2 h-7 w-7"
								onclick={clearFeatured}
							>
								<XIcon class="size-4" />
							</Button>
						</div>
					{:else}
						<label
							class="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border p-6 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:bg-muted/40"
						>
							<ImageIcon class="size-8" />
							<span>Click pentru upload</span>
							<input type="file" accept="image/*" class="hidden" onchange={pickFeatured} />
						</label>
					{/if}
				</div>
			</Card>
		</div>
	{/if}
</div>
