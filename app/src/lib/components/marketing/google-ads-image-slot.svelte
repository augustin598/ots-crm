<script lang="ts">
	import UploadIcon from '@lucide/svelte/icons/upload';
	import CheckIcon from '@lucide/svelte/icons/check';
	import XIcon from '@lucide/svelte/icons/x';
	import LoaderIcon from '@lucide/svelte/icons/loader';
	import ImageIcon from '@lucide/svelte/icons/image';
	import { toast } from 'svelte-sonner';
	import { validateImageDimensions, type ImageSlotSpec, type GoogleAdsCampaignType } from '$lib/shared/google-ads-specs';

	let {
		slot,
		campaignType,
		clientId,
		uploadUrl,
		category = 'google-ads',
		uploadedCount = $bindable(0),
		onUploaded
	}: {
		slot: ImageSlotSpec;
		campaignType: GoogleAdsCampaignType;
		clientId: string;
		uploadUrl: string;
		category?: string;
		uploadedCount: number;
		onUploaded?: () => void;
	} = $props();

	const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
	const ACCEPT = IMAGE_TYPES.join(',');

	interface QueueItem {
		file: File;
		status: 'pending' | 'uploading' | 'done' | 'error';
		error?: string;
	}

	let queue = $state<QueueItem[]>([]);
	let dragging = $state(false);
	let processing = $state(false);
	let fileInput: HTMLInputElement;

	async function getImageDims(file: File): Promise<{ w: number; h: number }> {
		return new Promise((resolve, reject) => {
			const img = new Image();
			const url = URL.createObjectURL(file);
			img.onload = () => {
				URL.revokeObjectURL(url);
				resolve({ w: img.naturalWidth, h: img.naturalHeight });
			};
			img.onerror = () => {
				URL.revokeObjectURL(url);
				reject(new Error('Nu s-a putut citi imaginea'));
			};
			img.src = url;
		});
	}

	async function addFiles(files: FileList | File[]) {
		const fileArray = Array.from(files);

		for (const file of fileArray) {
			if (!IMAGE_TYPES.includes(file.type)) {
				toast.error(`${file.name}: Tip fișier neacceptat. Doar JPEG, PNG, GIF, WebP.`);
				continue;
			}
			if (file.size > slot.maxFileSize) {
				toast.error(`${file.name}: Depășește ${slot.maxFileSize / (1024 * 1024)}MB`);
				continue;
			}

			// Check dimensions
			try {
				const dims = await getImageDims(file);
				const result = validateImageDimensions(dims.w, dims.h, slot);
				if (!result.valid) {
					toast.error(`${file.name}: ${result.error}`);
					continue;
				}
			} catch {
				toast.error(`${file.name}: Nu s-au putut verifica dimensiunile`);
				continue;
			}

			// Check max count
			if (uploadedCount + queue.filter((q) => q.status !== 'error').length >= slot.maxCount) {
				toast.error(`Maxim ${slot.maxCount} imagini pentru ${slot.label}`);
				break;
			}

			queue = [...queue, { file, status: 'pending' }];
		}

		if (!processing) processQueue();
	}

	async function processQueue() {
		processing = true;

		while (true) {
			const idx = queue.findIndex((q) => q.status === 'pending');
			if (idx === -1) break;

			queue[idx].status = 'uploading';
			queue = [...queue];

			const item = queue[idx];
			const formData = new FormData();
			formData.append('file', item.file);
			formData.append('clientId', clientId);
			formData.append('category', category);
			formData.append('title', item.file.name.replace(/\.[^/.]+$/, ''));
			formData.append('autoRename', 'true');
			formData.append('campaignType', campaignType);
			formData.append('googleAdsSlotKey', slot.key);
			formData.append('tags', `google-ads-slot:${slot.key}`);

			try {
				const res = await fetch(uploadUrl, { method: 'POST', body: formData });
				if (!res.ok) {
					const body = await res.json().catch(() => ({ message: 'Eroare upload' }));
					throw new Error(body.message || `HTTP ${res.status}`);
				}
				queue[idx].status = 'done';
				uploadedCount++;
				onUploaded?.();
			} catch (e: any) {
				queue[idx].status = 'error';
				queue[idx].error = e.message || 'Eroare upload';
				toast.error(`${item.file.name}: ${e.message || 'Eroare upload'}`);
			}

			queue = [...queue];

			// Auto-clear completed after 2s
			if (queue[idx].status === 'done') {
				const capturedIdx = idx;
				setTimeout(() => {
					queue = queue.filter((_, i) => i !== capturedIdx);
				}, 2000);
			}
		}

		processing = false;
	}

	function handleDrop(e: DragEvent) {
		e.preventDefault();
		dragging = false;
		if (e.dataTransfer?.files) {
			addFiles(e.dataTransfer.files);
		}
	}

	function handleDragOver(e: DragEvent) {
		e.preventDefault();
		dragging = true;
	}

	function handleDragLeave() {
		dragging = false;
	}

	function handleFileSelect(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		if (input.files) {
			addFiles(input.files);
			input.value = '';
		}
	}
</script>

<div class="rounded-lg border p-4 space-y-3">
	<div class="flex items-center justify-between">
		<div class="flex items-center gap-2">
			<ImageIcon class="h-4 w-4 text-muted-foreground" />
			<span class="text-sm font-medium">{slot.label}</span>
			{#if slot.required}
				<span class="text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300">Obligatoriu</span>
			{:else}
				<span class="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">Opțional</span>
			{/if}
		</div>
		<span
			class="text-xs px-2 py-0.5 rounded-full {uploadedCount >= slot.minCount && slot.required
				? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
				: uploadedCount > 0
					? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
					: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'}"
		>
			{uploadedCount}/{slot.maxCount}
		</span>
	</div>

	<div class="text-xs text-muted-foreground space-y-0.5">
		<p>Recomandat: {slot.recommendedW}x{slot.recommendedH}px &middot; Min: {slot.minW}x{slot.minH}px</p>
		<p>Raport: {slot.aspectRatio[0]}:{slot.aspectRatio[1]} &middot; Max: {slot.maxFileSize / (1024 * 1024)}MB &middot; JPEG, PNG, GIF, WebP</p>
	</div>

	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors
			{dragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-primary/50'}"
		ondrop={handleDrop}
		ondragover={handleDragOver}
		ondragleave={handleDragLeave}
		onclick={() => fileInput?.click()}
		onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInput?.click(); }}
		role="button"
		tabindex="0"
	>
		<UploadIcon class="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
		<p class="text-xs text-muted-foreground">Trage imaginile aici sau click pentru a selecta</p>
	</div>

	<input
		bind:this={fileInput}
		type="file"
		accept={ACCEPT}
		multiple
		class="hidden"
		onchange={handleFileSelect}
	/>

	{#if queue.length > 0}
		<div class="space-y-1">
			{#each queue as item, i (i)}
				<div class="flex items-center gap-2 text-xs py-1 px-2 rounded bg-muted/50">
					{#if item.status === 'uploading'}
						<LoaderIcon class="h-3 w-3 animate-spin text-blue-500" />
					{:else if item.status === 'done'}
						<CheckIcon class="h-3 w-3 text-green-500" />
					{:else if item.status === 'error'}
						<XIcon class="h-3 w-3 text-red-500" />
					{:else}
						<div class="h-3 w-3 rounded-full border border-muted-foreground/30"></div>
					{/if}
					<span class="truncate flex-1">{item.file.name}</span>
					{#if item.error}
						<span class="text-red-500 truncate">{item.error}</span>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>
