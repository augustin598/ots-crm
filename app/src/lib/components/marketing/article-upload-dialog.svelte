<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import UploadIcon from '@lucide/svelte/icons/upload';
	import FileIcon from '@lucide/svelte/icons/file';
	import ImageIcon from '@lucide/svelte/icons/image';
	import XIcon from '@lucide/svelte/icons/x';
	import LoaderIcon from '@lucide/svelte/icons/loader';
	import { toast } from 'svelte-sonner';
	import MaterialColorTagPicker from './material-color-tag-picker.svelte';
	import { serializeColorTags, type ColorTag } from './tag-colors';

	let {
		open = $bindable(false),
		category = 'press-article',
		clientId,
		uploadUrl,
		onUploaded
	}: {
		open: boolean;
		category: string;
		clientId: string;
		uploadUrl: string;
		onUploaded?: () => void;
	} = $props();

	let title = $state('');
	let description = $state('');
	let tags = $state<ColorTag[]>([]);
	let docFile = $state<File | null>(null);
	let imageFiles = $state<File[]>([]);
	let imagePreviews = $state<string[]>([]);
	let uploading = $state(false);
	let dragOverDoc = $state(false);
	let dragOverImg = $state(false);

	function resetForm() {
		title = '';
		description = '';
		tags = [];
		docFile = null;
		imageFiles = [];
		revokeImagePreviews();
		imagePreviews = [];
		uploading = false;
		dragOverDoc = false;
		dragOverImg = false;
	}

	function revokeImagePreviews() {
		for (const url of imagePreviews) {
			URL.revokeObjectURL(url);
		}
	}

	const DOC_TYPES = [
		'application/pdf',
		'application/msword',
		'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
		'text/plain'
	];
	const DOC_ACCEPT = '.pdf,.doc,.docx,.txt';
	const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
	const IMAGE_ACCEPT = 'image/jpeg,image/png,image/gif,image/webp';
	const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
	const MAX_IMAGES = 3;

	function validateDocFile(file: File): boolean {
		if (!DOC_TYPES.includes(file.type)) {
			toast.error('Tip de fișier neacceptat. Acceptăm: PDF, DOC, DOCX, TXT.');
			return false;
		}
		if (file.size > MAX_FILE_SIZE) {
			toast.error('Fișierul depășește dimensiunea maximă de 10MB');
			return false;
		}
		return true;
	}

	function validateImageFile(file: File): boolean {
		if (!IMAGE_TYPES.includes(file.type)) {
			toast.error(`"${file.name}" nu este o imagine acceptată. Acceptăm: JPG, PNG, GIF, WebP.`);
			return false;
		}
		if (file.size > MAX_FILE_SIZE) {
			toast.error(`"${file.name}" depășește dimensiunea maximă de 10MB`);
			return false;
		}
		return true;
	}

	function handleDocSelect(e: Event) {
		const input = e.target as HTMLInputElement;
		if (input.files?.[0]) {
			const file = input.files[0];
			if (!validateDocFile(file)) {
				input.value = '';
				return;
			}
			docFile = file;
			if (!title) {
				title = file.name.replace(/\.[^/.]+$/, '');
			}
		}
	}

	function handleDocDrop(e: DragEvent) {
		e.preventDefault();
		dragOverDoc = false;
		if (e.dataTransfer?.files?.[0]) {
			const file = e.dataTransfer.files[0];
			if (!validateDocFile(file)) return;
			docFile = file;
			if (!title) {
				title = file.name.replace(/\.[^/.]+$/, '');
			}
		}
	}

	function handleImageSelect(e: Event) {
		const input = e.target as HTMLInputElement;
		if (!input.files) return;
		addImages(Array.from(input.files));
		input.value = '';
	}

	function handleImageDrop(e: DragEvent) {
		e.preventDefault();
		dragOverImg = false;
		if (!e.dataTransfer?.files) return;
		addImages(Array.from(e.dataTransfer.files));
	}

	function addImages(files: File[]) {
		const remaining = MAX_IMAGES - imageFiles.length;
		if (remaining <= 0) {
			toast.error('Maximum 3 imagini permise');
			return;
		}

		const toAdd = files.slice(0, remaining);
		const valid: File[] = [];
		for (const f of toAdd) {
			if (validateImageFile(f)) valid.push(f);
		}

		if (files.length > remaining) {
			toast.error(`Doar ${remaining} imagine/imagini mai pot fi adăugate (max ${MAX_IMAGES})`);
		}

		const newPreviews = valid.map((f) => URL.createObjectURL(f));
		imageFiles = [...imageFiles, ...valid];
		imagePreviews = [...imagePreviews, ...newPreviews];
	}

	function removeImage(index: number) {
		URL.revokeObjectURL(imagePreviews[index]);
		imageFiles = imageFiles.filter((_, i) => i !== index);
		imagePreviews = imagePreviews.filter((_, i) => i !== index);
	}

	function formatFileSize(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	async function handleUpload() {
		if (!docFile) {
			toast.error('Fișierul document este obligatoriu');
			return;
		}
		if (!title.trim()) {
			toast.error('Titlul este obligatoriu');
			return;
		}
		if (title.trim().length > 200) {
			toast.error('Titlul nu poate depăși 200 de caractere');
			return;
		}
		uploading = true;

		try {
			const formData = new FormData();
			formData.append('file', docFile);
			for (const img of imageFiles) {
				formData.append('images', img);
			}
			formData.append('clientId', clientId);
			formData.append('category', category);
			formData.append('title', title.trim());
			if (description.trim()) formData.append('description', description.trim());
			const serializedTags = serializeColorTags(tags);
			if (serializedTags) formData.append('tags', serializedTags);

			const articleUploadUrl = uploadUrl.replace(/\/upload$/, '/upload-article');
			const response = await fetch(articleUploadUrl, {
				method: 'POST',
				body: formData
			});

			if (!response.ok) {
				const err = await response.json().catch(() => ({ message: 'Eroare la upload' }));
				throw new Error(err.message || `HTTP ${response.status}`);
			}

			toast.success('Articol încărcat cu succes');
			resetForm();
			open = false;
			onUploaded?.();
		} catch (e: any) {
			toast.error(e?.message || 'Eroare la încărcare articol');
		} finally {
			uploading = false;
		}
	}
</script>

<Dialog.Root bind:open onOpenChange={(o) => { if (!o) resetForm(); }}>
	<Dialog.Content class="sm:max-w-lg max-h-[85vh] overflow-y-auto">
		<Dialog.Header>
			<Dialog.Title>Adaugă Articol</Dialog.Title>
			<Dialog.Description>
				Încarcă un document text și până la 3 imagini pentru articol.
			</Dialog.Description>
		</Dialog.Header>

		<div class="space-y-4 pt-2">
			<!-- Document upload (required) -->
			<div class="space-y-1.5">
				<Label>Document <span class="text-destructive">*</span></Label>
				{#if docFile}
					<div class="flex items-center gap-3 p-3 bg-muted rounded-lg">
						<FileIcon class="h-8 w-8 text-muted-foreground shrink-0" />
						<div class="flex-1 min-w-0">
							<p class="text-sm font-medium truncate">{docFile.name}</p>
							<p class="text-xs text-muted-foreground">{formatFileSize(docFile.size)}</p>
						</div>
						<Button variant="ghost" size="icon" class="h-8 w-8 shrink-0" onclick={() => (docFile = null)}>
							<XIcon class="h-4 w-4" />
						</Button>
					</div>
				{:else}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						class="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors
							{dragOverDoc ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-primary/50'}"
						ondrop={handleDocDrop}
						ondragover={(e) => { e.preventDefault(); dragOverDoc = true; }}
						ondragleave={() => (dragOverDoc = false)}
						onclick={() => document.getElementById('article-doc-input')?.click()}
						onkeydown={(e) => { if (e.key === 'Enter') document.getElementById('article-doc-input')?.click(); }}
						role="button"
						tabindex="0"
					>
						<FileIcon class="h-6 w-6 mx-auto text-muted-foreground mb-1" />
						<p class="text-sm text-muted-foreground">
							Trage documentul aici sau <span class="text-primary font-medium">click pentru a selecta</span>
						</p>
						<p class="text-xs text-muted-foreground mt-1">PDF, DOC, DOCX, TXT (max 10MB)</p>
					</div>
					<input
						id="article-doc-input"
						type="file"
						class="hidden"
						accept={DOC_ACCEPT}
						onchange={handleDocSelect}
					/>
				{/if}
			</div>

			<!-- Title (auto-filled from doc name) -->
			<div class="space-y-1.5">
				<Label for="article-title">Titlu articol <span class="text-destructive">*</span></Label>
				<Input id="article-title" bind:value={title} maxlength={200} placeholder="Titlul articolului" />
			</div>

			<!-- Image uploads (optional, max 3) -->
			<div class="space-y-1.5">
				<Label>Imagini (opțional, max {MAX_IMAGES})</Label>

				{#if imagePreviews.length > 0}
					<div class="flex gap-2 flex-wrap">
						{#each imagePreviews as preview, i}
							<div class="relative group w-24 h-24 rounded-lg overflow-hidden border bg-muted">
								<img src={preview} alt={imageFiles[i]?.name} class="w-full h-full object-cover" />
								<button
									type="button"
									class="absolute top-1 right-1 bg-background/80 rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
									onclick={() => removeImage(i)}
								>
									<XIcon class="h-3.5 w-3.5" />
								</button>
								<p class="absolute bottom-0 left-0 right-0 bg-background/70 text-[10px] truncate px-1 py-0.5">
									{imageFiles[i]?.name}
								</p>
							</div>
						{/each}
					</div>
				{/if}

				{#if imageFiles.length < MAX_IMAGES}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						class="border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors
							{dragOverImg ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-primary/50'}"
						ondrop={handleImageDrop}
						ondragover={(e) => { e.preventDefault(); dragOverImg = true; }}
						ondragleave={() => (dragOverImg = false)}
						onclick={() => document.getElementById('article-img-input')?.click()}
						onkeydown={(e) => { if (e.key === 'Enter') document.getElementById('article-img-input')?.click(); }}
						role="button"
						tabindex="0"
					>
						<ImageIcon class="h-5 w-5 mx-auto text-muted-foreground mb-1" />
						<p class="text-sm text-muted-foreground">
							{imageFiles.length === 0 ? 'Adaugă imagini' : `Adaugă încă ${MAX_IMAGES - imageFiles.length}`}
						</p>
						<p class="text-xs text-muted-foreground mt-0.5">JPG, PNG, GIF, WebP (max 10MB)</p>
					</div>
					<input
						id="article-img-input"
						type="file"
						class="hidden"
						accept={IMAGE_ACCEPT}
						multiple
						onchange={handleImageSelect}
					/>
				{/if}

				{#if imageFiles.length > 0}
					<p class="text-xs text-muted-foreground">{imageFiles.length}/{MAX_IMAGES} imagini</p>
				{/if}
			</div>

			<!-- Description -->
			<div class="space-y-1.5">
				<Label for="article-desc">Descriere (opțional)</Label>
				<Textarea id="article-desc" bind:value={description} rows={2} maxlength={1000} placeholder="Descriere scurtă..." />
			</div>

			<!-- Tags -->
			<div class="space-y-1.5">
				<Label>Taguri (opțional)</Label>
				<MaterialColorTagPicker value={tags} onChange={(v) => { tags = v; }} />
			</div>
		</div>

		<Dialog.Footer class="pt-4">
			<Button variant="outline" onclick={() => { resetForm(); open = false; }}>Anulează</Button>
			<Button onclick={handleUpload} disabled={uploading}>
				{#if uploading}
					<LoaderIcon class="h-4 w-4 mr-2 animate-spin" />
					Se încarcă...
				{:else}
					<UploadIcon class="h-4 w-4 mr-2" />
					Adaugă
				{/if}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
