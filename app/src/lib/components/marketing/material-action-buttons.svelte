<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';

	let {
		material,
		canModify = false,
		onPreview,
		onEdit,
		onDelete,
		onDownload,
		onOpenUrl,
		variant = 'row'
	}: {
		material: any;
		canModify?: boolean;
		onPreview?: (material: any) => void;
		onEdit?: (material: any) => void;
		onDelete?: (material: any) => void;
		onDownload?: () => void;
		onOpenUrl?: () => void;
		variant?: 'row' | 'overlay';
	} = $props();

	const isOverlay = $derived(variant === 'overlay');
</script>

<div class="flex items-center {isOverlay ? 'gap-0.5' : 'gap-0.5'}">
	<!-- Preview -->
	{#if onPreview}
		<Button
			variant="ghost"
			size="icon"
			class="h-7 w-7 {isOverlay ? 'bg-white/80 dark:bg-black/60 backdrop-blur-sm hover:bg-white dark:hover:bg-black/80' : ''}"
			onclick={(e) => { e.stopPropagation(); onPreview?.(material); }}
			title="Vizualizează"
		>
			<EyeIcon class="h-3.5 w-3.5" />
		</Button>
	{/if}

	<!-- Download -->
	{#if material.filePath && onDownload}
		<Button
			variant="ghost"
			size="icon"
			class="h-7 w-7 {isOverlay ? 'bg-white/80 dark:bg-black/60 backdrop-blur-sm hover:bg-white dark:hover:bg-black/80' : ''}"
			onclick={(e) => { e.stopPropagation(); onDownload?.(); }}
			title="Descarcă"
		>
			<DownloadIcon class="h-3.5 w-3.5" />
		</Button>
	{/if}

	<!-- Open URL -->
	{#if material.externalUrl && onOpenUrl}
		<Button
			variant="ghost"
			size="icon"
			class="h-7 w-7 {isOverlay ? 'bg-white/80 dark:bg-black/60 backdrop-blur-sm hover:bg-white dark:hover:bg-black/80' : ''}"
			onclick={(e) => { e.stopPropagation(); onOpenUrl?.(); }}
			title="Deschide URL"
		>
			<ExternalLinkIcon class="h-3.5 w-3.5" />
		</Button>
	{/if}

	<!-- Edit -->
	{#if canModify && onEdit}
		<Button
			variant="ghost"
			size="icon"
			class="h-7 w-7 {isOverlay ? 'bg-white/80 dark:bg-black/60 backdrop-blur-sm hover:bg-white dark:hover:bg-black/80' : ''}"
			onclick={(e) => { e.stopPropagation(); onEdit?.(material); }}
			title="Editează"
		>
			<PencilIcon class="h-3.5 w-3.5" />
		</Button>
	{/if}

	<!-- Delete -->
	{#if canModify && onDelete}
		<Button
			variant="ghost"
			size="icon"
			class="h-7 w-7 text-destructive hover:text-destructive {isOverlay ? 'bg-white/80 dark:bg-black/60 backdrop-blur-sm hover:bg-white dark:hover:bg-black/80' : ''}"
			onclick={(e) => { e.stopPropagation(); onDelete?.(material); }}
			title="Șterge"
		>
			<Trash2Icon class="h-3.5 w-3.5" />
		</Button>
	{/if}
</div>
