<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import * as Select from '$lib/components/ui/select';
	import UploadIcon from '@lucide/svelte/icons/upload';
	import FileIcon from '@lucide/svelte/icons/file';
	import XIcon from '@lucide/svelte/icons/x';
	import LoaderIcon from '@lucide/svelte/icons/loader';
	import { toast } from 'svelte-sonner';

	interface SeoLinkOption {
		id: string;
		keyword: string | null;
		articleUrl: string | null;
	}

	let {
		open = $bindable(false),
		category = 'google-ads',
		clientId,
		uploadUrl,
		seoLinks = [],
		onUploaded,
		initialType = undefined
	}: {
		open: boolean;
		category: string;
		clientId: string;
		uploadUrl: string;
		seoLinks?: SeoLinkOption[];
		onUploaded?: () => void;
		initialType?: 'url' | 'text';
	} = $props();

	const isTypeLocked = $derived(initialType === 'url' || initialType === 'text');

	let title = $state('');
	let description = $state('');
	let seoLinkId = $state('');
	let tags = $state('');
	let textContent = $state('');
	let materialType = $state<'file' | 'text' | 'url'>(initialType || 'file');

	$effect(() => {
		if (open && initialType) {
			materialType = initialType;
		}
	});
	let externalUrl = $state('');
	let selectedFile = $state<File | null>(null);
	let uploading = $state(false);
	let dragOver = $state(false);

	function resetForm() {
		title = '';
		description = '';
		seoLinkId = '';
		tags = '';
		textContent = '';
		materialType = initialType || 'file';
		externalUrl = '';
		selectedFile = null;
		uploading = false;
		dragOver = false;
	}

	const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
	const VIDEO_TYPES = ['video/mp4', 'video/webm'];
	const DOC_TYPES = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain'];
	const ALL_ALLOWED_TYPES = [...IMAGE_TYPES, ...VIDEO_TYPES, ...DOC_TYPES];
	const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
	const MAX_VIDEO_SIZE = 50 * 1024 * 1024;
	const MAX_DOC_SIZE = 10 * 1024 * 1024;

	function validateFile(file: File): boolean {
		if (!ALL_ALLOWED_TYPES.includes(file.type)) {
			toast.error('Tip de fișier neacceptat. Acceptăm: imagini, video, PDF, DOC.');
			return false;
		}
		let maxSize = MAX_DOC_SIZE;
		if (IMAGE_TYPES.includes(file.type)) maxSize = MAX_IMAGE_SIZE;
		else if (VIDEO_TYPES.includes(file.type)) maxSize = MAX_VIDEO_SIZE;
		if (file.size > maxSize) {
			toast.error(`Fișierul depășește dimensiunea maximă de ${maxSize / (1024 * 1024)}MB`);
			return false;
		}
		return true;
	}

	function handleFileSelect(e: Event) {
		const input = e.target as HTMLInputElement;
		if (input.files?.[0]) {
			const file = input.files[0];
			if (!validateFile(file)) {
				input.value = '';
				return;
			}
			selectedFile = file;
			if (!title) {
				title = selectedFile.name.replace(/\.[^/.]+$/, '');
			}
		}
	}

	function handleDrop(e: DragEvent) {
		e.preventDefault();
		dragOver = false;
		if (e.dataTransfer?.files?.[0]) {
			const file = e.dataTransfer.files[0];
			if (!validateFile(file)) return;
			selectedFile = file;
			if (!title) {
				title = selectedFile.name.replace(/\.[^/.]+$/, '');
			}
		}
	}

	function handleDragOver(e: DragEvent) {
		e.preventDefault();
		dragOver = true;
	}

	function handleDragLeave() {
		dragOver = false;
	}

	function formatFileSize(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	function isValidHttpUrl(value: string): boolean {
		try {
			const url = new URL(value);
			return url.protocol === 'http:' || url.protocol === 'https:';
		} catch {
			return false;
		}
	}

	function validateTagsInput(value: string): boolean {
		const parts = value.split(',').map((t) => t.trim()).filter(Boolean);
		return parts.length <= 10 && parts.every((t) => t.length <= 50);
	}

	async function handleUpload() {
		if (!title.trim()) {
			toast.error('Titlul este obligatoriu');
			return;
		}
		if (title.trim().length > 200) {
			toast.error('Titlul nu poate depăși 200 de caractere');
			return;
		}
		if (tags.trim() && !validateTagsInput(tags)) {
			toast.error('Maximum 10 taguri, fiecare maxim 50 caractere');
			return;
		}

		uploading = true;

		try {
			if (materialType === 'file') {
				if (!selectedFile) {
					toast.error('Selectați un fișier');
					uploading = false;
					return;
				}

				const formData = new FormData();
				formData.append('file', selectedFile);
				formData.append('clientId', clientId);
				formData.append('category', category);
				formData.append('title', title.trim());
				if (description.trim()) formData.append('description', description.trim());
				if (seoLinkId) formData.append('seoLinkId', seoLinkId);
				if (tags.trim()) formData.append('tags', tags.trim());

				const response = await fetch(uploadUrl, {
					method: 'POST',
					body: formData
				});

				if (!response.ok) {
					const err = await response.json().catch(() => ({ message: 'Eroare la upload' }));
					throw new Error(err.message || `HTTP ${response.status}`);
				}

				toast.success('Material încărcat cu succes');
			} else if (materialType === 'text') {
				if (!textContent.trim()) {
					toast.error('Conținutul text este obligatoriu');
					uploading = false;
					return;
				}

				// Use createMarketingMaterial remote for text type
				const { createMarketingMaterial } = await import('$lib/remotes/marketing-materials.remote');
				await createMarketingMaterial({
					clientId,
					category: category as 'google-ads' | 'facebook-ads' | 'tiktok-ads' | 'press-article' | 'seo-article',
					type: 'text',
					title: title.trim(),
					description: description.trim() || null,
					textContent: textContent.trim(),
					seoLinkId: seoLinkId || null,
					tags: tags.trim() || null
				});

				toast.success('Material text creat cu succes');
			} else if (materialType === 'url') {
				if (!externalUrl.trim()) {
					toast.error('URL-ul este obligatoriu');
					uploading = false;
					return;
				}
				if (!isValidHttpUrl(externalUrl.trim())) {
					toast.error('URL invalid. Trebuie să înceapă cu https:// sau http://');
					uploading = false;
					return;
				}

				const { createMarketingMaterial } = await import('$lib/remotes/marketing-materials.remote');
				await createMarketingMaterial({
					clientId,
					category: category as 'google-ads' | 'facebook-ads' | 'tiktok-ads' | 'press-article' | 'seo-article',
					type: 'url',
					title: title.trim(),
					description: description.trim() || null,
					externalUrl: externalUrl.trim(),
					seoLinkId: seoLinkId || null,
					tags: tags.trim() || null
				});

				toast.success('Material URL creat cu succes');
			}

			resetForm();
			open = false;
			onUploaded?.();
		} catch (e: any) {
			toast.error(e?.message || 'Eroare la creare material');
		} finally {
			uploading = false;
		}
	}
</script>

<Dialog.Root bind:open onOpenChange={(o) => { if (!o) resetForm(); }}>
	<Dialog.Content class="sm:max-w-lg max-h-[85vh] overflow-y-auto">
		<Dialog.Header>
			<Dialog.Title>
				{#if initialType === 'url'}
					Adaugă URL Extern
				{:else if initialType === 'text'}
					Adaugă Text Ad
				{:else}
					Adaugă Material
				{/if}
			</Dialog.Title>
			<Dialog.Description>
				{#if initialType === 'url'}
					Adaugă un URL extern ca material de marketing.
				{:else if initialType === 'text'}
					Adaugă un text publicitar ca material de marketing.
				{:else}
					Încarcă un fișier, adaugă text publicitar sau un URL extern.
				{/if}
			</Dialog.Description>
		</Dialog.Header>

		<div class="space-y-4 pt-2">
			<!-- Material type selector -->
			{#if !isTypeLocked}
				<div class="flex gap-2">
					<Button
						variant={materialType === 'file' ? 'default' : 'outline'}
						size="sm"
						onclick={() => (materialType = 'file')}
					>
						<FileIcon class="h-4 w-4 mr-1" /> Fișier
					</Button>
					<Button
						variant={materialType === 'text' ? 'default' : 'outline'}
						size="sm"
						onclick={() => (materialType = 'text')}
					>
						Text Ad
					</Button>
					<Button
						variant={materialType === 'url' ? 'default' : 'outline'}
						size="sm"
						onclick={() => (materialType = 'url')}
					>
						URL Extern
					</Button>
				</div>
			{/if}

			<!-- File upload area -->
			{#if materialType === 'file'}
				{#if selectedFile}
					<div class="flex items-center gap-3 p-3 bg-muted rounded-lg">
						<FileIcon class="h-8 w-8 text-muted-foreground shrink-0" />
						<div class="flex-1 min-w-0">
							<p class="text-sm font-medium truncate">{selectedFile.name}</p>
							<p class="text-xs text-muted-foreground">{formatFileSize(selectedFile.size)}</p>
						</div>
						<Button variant="ghost" size="icon" class="h-8 w-8 shrink-0" onclick={() => (selectedFile = null)}>
							<XIcon class="h-4 w-4" />
						</Button>
					</div>
				{:else}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						class="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors
							{dragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-primary/50'}"
						ondrop={handleDrop}
						ondragover={handleDragOver}
						ondragleave={handleDragLeave}
						onclick={() => document.getElementById('material-file-input')?.click()}
						onkeydown={(e) => { if (e.key === 'Enter') document.getElementById('material-file-input')?.click(); }}
						role="button"
						tabindex="0"
					>
						<UploadIcon class="h-8 w-8 mx-auto text-muted-foreground mb-2" />
						<p class="text-sm text-muted-foreground">
							Trage fișierul aici sau <span class="text-primary font-medium">click pentru a selecta</span>
						</p>
						<p class="text-xs text-muted-foreground mt-1">
							Imagini (10MB), Video (50MB), Documente (10MB)
						</p>
					</div>
					<input
						id="material-file-input"
						type="file"
						class="hidden"
						accept="image/jpeg,image/png,image/gif,image/webp,video/mp4,video/webm,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
						onchange={handleFileSelect}
					/>
				{/if}
			{/if}

			<!-- Text content area -->
			{#if materialType === 'text'}
				<div class="space-y-1.5">
					<Label for="text-content">Conținut Text</Label>
					<Textarea id="text-content" bind:value={textContent} rows={4} maxlength={5000} placeholder="Textul materialului publicitar..." />
					<p class="text-xs text-muted-foreground text-right">{textContent.length}/5000</p>
				</div>
			{/if}

			<!-- External URL area -->
			{#if materialType === 'url'}
				<div class="space-y-1.5">
					<Label for="external-url">URL Extern</Label>
					<Input id="external-url" type="url" bind:value={externalUrl} placeholder="https://youtube.com/watch?v=..." />
				</div>
			{/if}

			<!-- Title -->
			<div class="space-y-1.5">
				<Label for="material-title">Titlu</Label>
				<Input id="material-title" bind:value={title} maxlength={200} placeholder="Numele materialului" />
			</div>

			<!-- Description -->
			<div class="space-y-1.5">
				<Label for="material-desc">Descriere (opțional)</Label>
				<Textarea id="material-desc" bind:value={description} rows={2} maxlength={1000} placeholder="Descriere scurtă..." />
			</div>

			<!-- SEO Link selector (only for seo-article category) -->
			{#if category === 'seo-article' && seoLinks.length > 0}
				<div class="space-y-1.5">
					<Label>Link SEO asociat (opțional)</Label>
					<Select.Root type="single" bind:value={seoLinkId}>
						<Select.Trigger>
							{seoLinks.find((l) => l.id === seoLinkId)?.keyword || 'Selectează un backlink...'}
						</Select.Trigger>
						<Select.Content>
							<Select.Item value="">Niciunul</Select.Item>
							{#each seoLinks as link}
								<Select.Item value={link.id}>
									{link.keyword || 'N/A'} — {link.articleUrl || 'fără URL'}
								</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
			{/if}

			<!-- Tags -->
			<div class="space-y-1.5">
				<Label for="material-tags">Taguri (opțional, separate prin virgulă)</Label>
				<Input id="material-tags" bind:value={tags} placeholder="banner, promo, campanie-iarna" />
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
