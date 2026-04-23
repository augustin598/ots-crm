<script lang="ts">
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
	import ImageIcon from '@lucide/svelte/icons/image';
	import XIcon from '@lucide/svelte/icons/x';

	const tenantSlug = $derived(page.params.tenant);
	const siteId = $derived(page.params.siteId);
	const apiBase = $derived(`/${tenantSlug}/api/wordpress/sites/${siteId}/posts`);
	const mediaEndpoint = $derived(
		`/${tenantSlug}/api/wordpress/sites/${siteId}/posts`
	); // the POST handler uploads inline images automatically; see below

	let title = $state('');
	let slug = $state('');
	let excerpt = $state('');
	let status = $state<'draft' | 'publish' | 'future' | 'pending' | 'private'>('draft');
	let publishedAt = $state(''); // datetime-local string when status=future
	let contentHtml = $state('');
	let saving = $state(false);

	let featuredFile = $state<File | null>(null);
	let featuredPreview = $state<string | null>(null);
	let featuredMediaId = $state<number | null>(null);

	let editorRef = $state<RichEditor | null>(null);

	function handleEditorUpdate(data: { html: string }) {
		contentHtml = data.html;
	}

	/**
	 * The RichEditor calls this when the user clicks the image upload button
	 * in the toolbar. We return a data URL so TipTap renders the image
	 * inline; the POST /posts endpoint then extracts + uploads it to WP
	 * media when the post is saved. One round-trip instead of two.
	 */
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
	}

	function clearFeatured() {
		featuredFile = null;
		featuredPreview = null;
		featuredMediaId = null;
	}

	async function uploadFeaturedFirst(): Promise<number | null> {
		if (!featuredFile || !featuredPreview) return featuredMediaId;
		// The preview already is a data URL; split to extract the base64 body.
		const match = featuredPreview.match(/^data:([^;]+);base64,(.+)$/);
		if (!match) {
			toast.error('Imaginea selectată nu a putut fi citită');
			return null;
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
			return null;
		}
		featuredMediaId = body.id;
		return body.id;
	}

	async function save(nextStatus: 'draft' | 'publish' | 'future') {
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
			// Upload featured image first (separate endpoint).
			let featuredId: number | null = featuredMediaId;
			if (featuredFile && !featuredId) {
				featuredId = await uploadFeaturedFirst();
				if (featuredId === null) return;
			}

			const payload = {
				title: title.trim(),
				slug: slug.trim() || undefined,
				excerpt: excerpt.trim() || undefined,
				contentHtml,
				status: nextStatus,
				publishedAt:
					nextStatus === 'future' && publishedAt
						? new Date(publishedAt).toISOString()
						: undefined,
				featuredMediaId: featuredId ?? undefined
			};

			const res = await fetch(apiBase, {
				method: 'POST',
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
			const label = nextStatus === 'publish' ? 'publicată' : nextStatus === 'future' ? 'programată' : 'salvată ca ciornă';
			toast.success(
				`Postare ${label}${body.uploadedAttachments ? ` (${body.uploadedAttachments} imagini)` : ''}`
			);
			if (body.post?.id) {
				goto(`/${tenantSlug}/wordpress/${siteId}/posts/${body.post.id}`);
			} else {
				goto(`/${tenantSlug}/wordpress/${siteId}/posts`);
			}
		} catch (err) {
			toast.error('Eroare de rețea');
			console.error(err);
		} finally {
			saving = false;
		}
	}
</script>

<svelte:head>
	<title>Postare nouă — OTS CRM</title>
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
		<h1 class="text-2xl font-semibold tracking-tight">Postare nouă</h1>
		<div class="flex items-center gap-2">
			<Button variant="outline" disabled={saving} onclick={() => save('draft')}>
				<SaveIcon class="mr-2 size-4" />
				Salvează ciornă
			</Button>
			{#if status === 'future'}
				<Button disabled={saving} onclick={() => save('future')}>
					<SendIcon class="mr-2 size-4" />
					Programează
				</Button>
			{:else}
				<Button disabled={saving} onclick={() => save('publish')}>
					<SendIcon class="mr-2 size-4" />
					Publică acum
				</Button>
			{/if}
		</div>
	</div>

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
				<Label for="post-slug">Slug (opțional)</Label>
				<Input
					id="post-slug"
					bind:value={slug}
					placeholder="titlul-postarii"
					autocomplete="off"
				/>
				<p class="text-xs text-muted-foreground">
					Dacă îl lași gol, WordPress îl generează din titlu.
				</p>
			</div>

			<div class="flex flex-col gap-1">
				<Label>Conținut</Label>
				<RichEditor
					bind:this={editorRef}
					placeholder="Scrie postarea..."
					onUpdate={handleEditorUpdate}
					{onImageUpload}
					{onPasteImage}
					minHeight="400px"
				/>
				<p class="text-xs text-muted-foreground">
					Imaginile lipite / inserate sunt urcate automat în biblioteca media WordPress la salvare.
				</p>
			</div>

			<div class="flex flex-col gap-1">
				<Label for="post-excerpt">Rezumat (opțional)</Label>
				<Textarea
					id="post-excerpt"
					bind:value={excerpt}
					placeholder="Scurt rezumat care apare în listări și meta description"
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
</div>
