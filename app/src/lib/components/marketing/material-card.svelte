<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Card } from '$lib/components/ui/card';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import ImageIcon from '@lucide/svelte/icons/image';
	import VideoIcon from '@lucide/svelte/icons/video';
	import FileTextIcon from '@lucide/svelte/icons/file-text';
	import TypeIcon from '@lucide/svelte/icons/type';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import { getMaterialDownloadUrl } from '$lib/remotes/marketing-materials.remote';

	interface Material {
		id: string;
		type: string;
		title: string;
		description: string | null;
		filePath: string | null;
		fileSize: number | null;
		mimeType: string | null;
		fileName: string | null;
		textContent: string | null;
		dimensions: string | null;
		externalUrl: string | null;
		status: string;
		seoLinkKeyword?: string | null;
		seoLinkArticleUrl?: string | null;
		createdAt: Date;
		uploadedByUserId: string | null;
		uploadedByClientUserId: string | null;
	}

	let {
		material,
		thumbnailUrl = null,
		readonly = false,
		currentClientUserId = null,
		onEdit,
		onDelete
	}: {
		material: Material;
		thumbnailUrl?: string | null;
		readonly?: boolean;
		currentClientUserId?: string | null;
		onEdit?: (material: Material) => void;
		onDelete?: (material: Material) => void;
	} = $props();

	const typeIcons: Record<string, any> = {
		image: ImageIcon,
		video: VideoIcon,
		document: FileTextIcon,
		text: TypeIcon,
		url: ExternalLinkIcon
	};

	const statusColors: Record<string, string> = {
		active: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
		draft: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
		archived: 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200'
	};

	function formatFileSize(bytes: number | null): string {
		if (!bytes) return '';
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	function formatDate(date: Date): string {
		return new Date(date).toLocaleDateString('ro-RO', { day: '2-digit', month: 'short', year: 'numeric' });
	}

	// Can edit/delete: admin always, client only own uploads
	const canModify = $derived(
		!readonly && (
			!currentClientUserId ||
			material.uploadedByClientUserId === currentClientUserId
		)
	);

	let downloading = $state(false);

	async function handleDownload() {
		if (!material.filePath) return;
		downloading = true;
		try {
			const result = await getMaterialDownloadUrl(material.id);
			window.open(result.url, '_blank');
		} catch (e) {
			console.error('Download error:', e);
		} finally {
			downloading = false;
		}
	}
</script>

<Card class="group overflow-hidden transition-shadow hover:shadow-md">
	<!-- Thumbnail area -->
	<div class="relative aspect-[4/3] bg-muted flex items-center justify-center overflow-hidden">
		{#if material.type === 'image' && thumbnailUrl}
			<img src={thumbnailUrl} alt={material.title} class="w-full h-full object-cover" />
		{:else if material.type === 'text'}
			<div class="p-3 text-xs text-muted-foreground line-clamp-5 font-mono">
				{material.textContent || 'Text material'}
			</div>
		{:else}
			{@const IconComponent = typeIcons[material.type] || FileTextIcon}
			<IconComponent class="h-12 w-12 text-muted-foreground/50" />
		{/if}

		<!-- Overlay actions on hover -->
		<div class="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
			{#if material.filePath}
				<Button variant="secondary" size="icon" class="h-8 w-8" onclick={handleDownload} disabled={downloading}>
					<DownloadIcon class="h-4 w-4" />
				</Button>
			{/if}
			{#if material.externalUrl}
				<Button variant="secondary" size="icon" class="h-8 w-8" onclick={() => window.open(material.externalUrl!, '_blank')}>
					<ExternalLinkIcon class="h-4 w-4" />
				</Button>
			{/if}
			{#if canModify && onEdit}
				<Button variant="secondary" size="icon" class="h-8 w-8" onclick={() => onEdit?.(material)}>
					<PencilIcon class="h-4 w-4" />
				</Button>
			{/if}
			{#if canModify && onDelete}
				<Button variant="destructive" size="icon" class="h-8 w-8" onclick={() => onDelete?.(material)}>
					<Trash2Icon class="h-4 w-4" />
				</Button>
			{/if}
		</div>

		<!-- Type badge -->
		<div class="absolute top-2 left-2">
			<Badge variant="secondary" class="text-xs capitalize">{material.type}</Badge>
		</div>

		<!-- Dimensions -->
		{#if material.dimensions}
			<div class="absolute bottom-2 left-2">
				<span class="text-xs text-white bg-black/60 px-1.5 py-0.5 rounded">{material.dimensions}</span>
			</div>
		{/if}
	</div>

	<!-- Info area -->
	<div class="p-3 space-y-1">
		<h4 class="text-sm font-medium truncate" title={material.title}>{material.title}</h4>
		{#if material.description}
			<p class="text-xs text-muted-foreground line-clamp-2">{material.description}</p>
		{/if}
		{#if material.seoLinkKeyword}
			<p class="text-xs text-blue-600 dark:text-blue-400 truncate">SEO: {material.seoLinkKeyword}</p>
		{/if}
		<div class="flex items-center justify-between pt-1">
			<div class="flex items-center gap-1.5">
				<span class={`text-xs px-1.5 py-0.5 rounded ${statusColors[material.status] || ''}`}>
					{material.status}
				</span>
				{#if material.fileSize}
					<span class="text-xs text-muted-foreground">{formatFileSize(material.fileSize)}</span>
				{/if}
			</div>
			<span class="text-xs text-muted-foreground">{formatDate(material.createdAt)}</span>
		</div>
	</div>
</Card>
