<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { uploadImage } from '$lib/remotes/upload.remote';
	import { Upload, X, Loader2 } from 'lucide-svelte';
	import { cn } from '$lib/utils';

	type Props = {
		imageUrl?: string;
		altText?: string;
		onImageChange?: (imageUrl: string) => void;
		onAltTextChange?: (altText: string) => void;
		onRemove?: () => void;
		disabled?: boolean;
		class?: string;
		folder?: string;
	};

	let {
		imageUrl = $bindable(''),
		altText = $bindable(''),
		onImageChange,
		onAltTextChange,
		onRemove,
		disabled = false,
		class: className,
		folder = 'products'
	}: Props = $props();

	let isDragging = $state(false);
	let isUploading = $state(false);
	let uploadError = $state<string | null>(null);
	let previewUrl = $state<string | null>(null);
	let fileInput: HTMLInputElement | null = $state(null);

	// Set preview URL when imageUrl changes
	$effect(() => {
		if (imageUrl) {
			previewUrl = imageUrl;
		}
	});

	function handleDragOver(e: DragEvent) {
		e.preventDefault();
		e.stopPropagation();
		if (!disabled) {
			isDragging = true;
		}
	}

	function handleDragLeave(e: DragEvent) {
		e.preventDefault();
		e.stopPropagation();
		isDragging = false;
	}

	function handleDrop(e: DragEvent) {
		e.preventDefault();
		e.stopPropagation();
		isDragging = false;

		if (disabled) return;

		const files = e.dataTransfer?.files;
		if (files && files.length > 0) {
			handleFile(files[0]);
		}
	}

	function handleFileSelect(e: Event) {
		const target = e.target as HTMLInputElement;
		const files = target.files;
		if (files && files.length > 0) {
			handleFile(files[0]);
		}
	}

	async function handleFile(file: File) {
		if (!file.type.startsWith('image/')) {
			uploadError = 'Please select an image file';
			return;
		}

		if (file.size > 10 * 1024 * 1024) {
			uploadError = 'File size must be less than 10MB';
			return;
		}

		isUploading = true;
		uploadError = null;

		// Create preview and convert to base64
		const reader = new FileReader();
		reader.onload = async (e) => {
			const base64Data = e.target?.result as string;
			previewUrl = base64Data;

			try {
				// Upload using base64 data
				const result = await uploadImage({
					fileData: base64Data,
					fileName: file.name,
					fileType: file.type,
					folder: folder
				});
				imageUrl = result.url;
				onImageChange?.(result.url);
			} catch (error) {
				uploadError = error instanceof Error ? error.message : 'Failed to upload image';
				previewUrl = null;
			} finally {
				isUploading = false;
			}
		};
		reader.readAsDataURL(file);
	}

	function handleRemove() {
		imageUrl = '';
		previewUrl = null;
		uploadError = null;
		if (fileInput) {
			fileInput.value = '';
		}
		onRemove?.();
	}
</script>

<div class={cn('space-y-2', className)}>
	{#if previewUrl || imageUrl}
		<!-- Preview with existing image -->
		<div class="relative group">
			<div class="relative h-[100px] w-full overflow-hidden rounded-md border bg-muted">
				<img
					src={previewUrl || imageUrl}
					alt={altText || 'Preview'}
					class="h-full rounded-md object-contain"
				/>
				{#if !disabled}
					<Button
						type="button"
						variant="destructive"
						size="sm"
						class="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity"
						onclick={handleRemove}
					>
						<X class="h-4 w-4" />
					</Button>
				{/if}
			</div>
			<div class="mt-2 space-y-2">
				<div class="space-y-2">
					<Label for="altText-{Math.random()}">Alt Text (optional)</Label>
					<Input
						id="altText-{Math.random()}"
						bind:value={altText}
						placeholder="Image alt text"
						disabled={disabled}
						oninput={() => onAltTextChange?.(altText)}
					/>
				</div>
			</div>
		</div>
	{:else}
		<!-- Upload area -->
		<div
			class={cn(
				'relative gap-8 flex h-[100px] w-full flex-row items-center justify-center rounded-lg border-2 border-dashed p-8 transition-colors',
				isDragging && !disabled
					? 'border-primary bg-primary/5'
					: 'border-muted-foreground/25 bg-muted/50',
				disabled && 'opacity-50 cursor-not-allowed',
				!disabled && 'cursor-pointer hover:border-primary/50'
			)}
			role="button"
			tabindex={disabled ? -1 : 0}
			ondragover={handleDragOver}
			ondragleave={handleDragLeave}
			ondrop={handleDrop}
			onclick={() => !disabled && fileInput?.click()}
			onkeydown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !disabled) { e.preventDefault(); fileInput?.click(); } }}
		>
			<input
				bind:this={fileInput}
				type="file"
				accept="image/*"
				class="hidden"
				disabled={disabled}
				onchange={handleFileSelect}
			/>

			{#if isUploading}
				<Loader2 class="h-8 w-8 animate-spin text-muted-foreground " />
				<p class="text-sm font-medium text-muted-foreground">Uploading...</p>
			{:else}
				<Upload class="h-8 w-8 text-muted-foreground " />
				<div class="text-center">
					<p class="text-sm font-medium">
						<span class="text-primary underline">Click to upload</span> or drag and drop
					</p>
					<p class="text-xs text-muted-foreground mt-1">
						PNG, JPG, GIF up to 10MB
					</p>
				</div>
			{/if}
		</div>
	{/if}

	{#if uploadError}
		<p class="text-sm text-destructive">{uploadError}</p>
	{/if}
</div>

