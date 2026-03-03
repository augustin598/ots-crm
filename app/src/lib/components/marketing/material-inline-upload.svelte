<script lang="ts">
	import ImageIcon from '@lucide/svelte/icons/image';
	import VideoIcon from '@lucide/svelte/icons/video';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import UploadIcon from '@lucide/svelte/icons/upload';
	import CheckIcon from '@lucide/svelte/icons/check';
	import XIcon from '@lucide/svelte/icons/x';
	import LoaderIcon from '@lucide/svelte/icons/loader';
	import { toast } from 'svelte-sonner';

	type FileFilterType = 'image' | 'video' | 'document';

	let {
		filterType,
		category,
		clientId,
		uploadUrl,
		onUploaded
	}: {
		filterType: FileFilterType;
		category: string;
		clientId: string;
		uploadUrl: string;
		onUploaded?: () => void;
	} = $props();

	const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
	const VIDEO_TYPES = ['video/mp4', 'video/webm'];
	const DOC_TYPES = [
		'application/pdf',
		'application/msword',
		'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
	];

	const CONFIG: Record<FileFilterType, { types: string[]; maxSize: number; accept: string; label: string; sizeLabel: string }> = {
		image: {
			types: IMAGE_TYPES,
			maxSize: 10 * 1024 * 1024,
			accept: IMAGE_TYPES.join(','),
			label: 'JPEG, PNG, GIF, WebP',
			sizeLabel: '10MB'
		},
		video: {
			types: VIDEO_TYPES,
			maxSize: 50 * 1024 * 1024,
			accept: VIDEO_TYPES.join(','),
			label: 'MP4, WebM',
			sizeLabel: '50MB'
		},
		document: {
			types: DOC_TYPES,
			maxSize: 10 * 1024 * 1024,
			accept: DOC_TYPES.join(','),
			label: 'PDF, DOC, DOCX',
			sizeLabel: '10MB'
		}
	};

	const ICONS: Record<FileFilterType, typeof ImageIcon> = {
		image: ImageIcon,
		video: VideoIcon,
		document: FileTextIcon
	};

	const TYPE_LABELS: Record<FileFilterType, string> = {
		image: 'imaginile',
		video: 'fisierele video',
		document: 'documentele'
	};

	interface FileUploadItem {
		id: string;
		file: File;
		title: string;
		status: 'pending' | 'uploading' | 'done' | 'error';
		errorMessage?: string;
	}

	let fileQueue = $state<FileUploadItem[]>([]);
	let dragOver = $state(false);
	let uploading = $state(false);

	const config = $derived(CONFIG[filterType]);
	const Icon = $derived(ICONS[filterType]);
	const inputId = $derived(`inline-upload-${filterType}`);

	function titleFromFilename(filename: string): string {
		return filename.replace(/\.[^/.]+$/, '');
	}

	function formatFileSize(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	function validateFile(file: File): string | null {
		if (!config.types.includes(file.type)) {
			return `Tip neacceptat. Acceptam: ${config.label}`;
		}
		if (file.size > config.maxSize) {
			return `Depaseste ${config.sizeLabel}`;
		}
		return null;
	}

	function addFiles(files: FileList | File[]) {
		const newItems: FileUploadItem[] = [];
		for (const file of files) {
			const err = validateFile(file);
			if (err) {
				toast.error(`${file.name}: ${err}`);
				continue;
			}
			newItems.push({
				id: crypto.randomUUID(),
				file,
				title: titleFromFilename(file.name),
				status: 'pending'
			});
		}
		if (newItems.length > 0) {
			fileQueue = [...fileQueue, ...newItems];
			processQueue();
		}
	}

	async function processQueue() {
		if (uploading) return;
		uploading = true;

		while (true) {
			const next = fileQueue.find((f) => f.status === 'pending');
			if (!next) break;

			next.status = 'uploading';
			fileQueue = [...fileQueue];

			try {
				const formData = new FormData();
				formData.append('file', next.file);
				formData.append('clientId', clientId);
				formData.append('category', category);
				formData.append('title', next.title);
				formData.append('autoRename', 'true');

				const response = await fetch(uploadUrl, {
					method: 'POST',
					body: formData
				});

				if (!response.ok) {
					const err = await response.json().catch(() => ({ message: 'Eroare la upload' }));
					throw new Error(err.message || `HTTP ${response.status}`);
				}

				next.status = 'done';
				fileQueue = [...fileQueue];
				onUploaded?.();

				// Auto-clear done items after 2s
				const doneId = next.id;
				setTimeout(() => {
					fileQueue = fileQueue.filter((f) => f.id !== doneId);
				}, 2000);
			} catch (e: any) {
				next.status = 'error';
				next.errorMessage = e?.message || 'Eroare la upload';
				fileQueue = [...fileQueue];
			}
		}

		uploading = false;
	}

	function handleDrop(e: DragEvent) {
		e.preventDefault();
		dragOver = false;
		if (e.dataTransfer?.files?.length) {
			addFiles(e.dataTransfer.files);
		}
	}

	function handleDragOver(e: DragEvent) {
		e.preventDefault();
		dragOver = true;
	}

	function handleDragLeave() {
		dragOver = false;
	}

	function handleFileSelect(e: Event) {
		const input = e.target as HTMLInputElement;
		if (input.files?.length) {
			addFiles(input.files);
			input.value = '';
		}
	}

	function removeItem(id: string) {
		fileQueue = fileQueue.filter((f) => f.id !== id);
	}
</script>

<div class="space-y-3">
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors
			{dragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-primary/50'}"
		ondrop={handleDrop}
		ondragover={handleDragOver}
		ondragleave={handleDragLeave}
		onclick={() => document.getElementById(inputId)?.click()}
		onkeydown={(e) => { if (e.key === 'Enter') document.getElementById(inputId)?.click(); }}
		role="button"
		tabindex="0"
	>
		<div class="flex flex-col items-center gap-2">
			<div class="flex items-center gap-2 text-muted-foreground">
				<Icon class="h-6 w-6" />
				<UploadIcon class="h-5 w-5" />
			</div>
			<p class="text-sm text-muted-foreground">
				Trage {TYPE_LABELS[filterType]} aici sau <span class="text-primary font-medium">click pentru a selecta</span>
			</p>
			<p class="text-xs text-muted-foreground">
				{config.label} — max {config.sizeLabel}
			</p>
		</div>
	</div>

	<input
		id={inputId}
		type="file"
		multiple
		class="hidden"
		accept={config.accept}
		onchange={handleFileSelect}
	/>

	<!-- Upload queue -->
	{#if fileQueue.length > 0}
		<div class="space-y-1.5">
			{#each fileQueue as item (item.id)}
				<div class="flex items-center gap-3 px-3 py-2 bg-muted/50 rounded-md text-sm">
					{#if item.status === 'uploading'}
						<LoaderIcon class="h-4 w-4 animate-spin text-primary shrink-0" />
					{:else if item.status === 'done'}
						<CheckIcon class="h-4 w-4 text-green-600 shrink-0" />
					{:else if item.status === 'error'}
						<XIcon class="h-4 w-4 text-destructive shrink-0" />
					{:else}
						<div class="h-4 w-4 rounded-full border-2 border-muted-foreground/30 shrink-0"></div>
					{/if}

					<span class="flex-1 truncate">{item.file.name}</span>
					<span class="text-xs text-muted-foreground shrink-0">{formatFileSize(item.file.size)}</span>

					{#if item.status === 'error'}
						<span class="text-xs text-destructive shrink-0">{item.errorMessage}</span>
						<button class="text-muted-foreground hover:text-foreground shrink-0" onclick={() => removeItem(item.id)}>
							<XIcon class="h-3.5 w-3.5" />
						</button>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>
