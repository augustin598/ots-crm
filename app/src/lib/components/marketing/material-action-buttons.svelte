<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import EyeIcon from '@lucide/svelte/icons/eye';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import CheckIcon from '@lucide/svelte/icons/check';
	import { toast } from 'svelte-sonner';

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

	// Quick copy for URL/text materials
	const hasCopyable = $derived(
		(material.type === 'url' && (material.externalUrl || material.textContent)) ||
		(material.type === 'text' && material.textContent)
	);

	let justCopied = $state(false);
	async function handleCopy(e: Event) {
		e.stopPropagation();
		let text = '';
		if (material.externalUrl) text = material.externalUrl;
		else if (material.textContent) {
			try {
				const parsed = JSON.parse(material.textContent);
				if (Array.isArray(parsed)) {
					text = parsed.flatMap((s: any) => s.urls || [s]).filter(Boolean).join('\n');
				} else if (typeof parsed === 'object') {
					text = Object.values(parsed).flat().filter(Boolean).join('\n');
				} else {
					text = material.textContent;
				}
			} catch {
				text = material.textContent;
			}
		}
		if (!text) return;
		try {
			await navigator.clipboard.writeText(text);
			justCopied = true;
			toast.success('Copiat');
			setTimeout(() => { justCopied = false; }, 1500);
		} catch {
			toast.error('Nu s-a putut copia');
		}
	}
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

	<!-- Quick Copy -->
	{#if hasCopyable}
		<Button
			variant="ghost"
			size="icon"
			class="h-7 w-7 {isOverlay ? 'bg-white/80 dark:bg-black/60 backdrop-blur-sm hover:bg-white dark:hover:bg-black/80' : ''}"
			onclick={handleCopy}
			title="Copiază conținut"
		>
			{#if justCopied}
				<CheckIcon class="h-3.5 w-3.5 text-green-500" />
			{:else}
				<CopyIcon class="h-3.5 w-3.5" />
			{/if}
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
