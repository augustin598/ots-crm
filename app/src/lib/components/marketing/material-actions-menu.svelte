<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import MoreVerticalIcon from '@lucide/svelte/icons/more-vertical';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';

	let {
		material,
		canModify = false,
		onEdit,
		onDelete,
		onDownload,
		onOpenUrl,
		triggerClass = ''
	}: {
		material: any;
		canModify?: boolean;
		onEdit?: (material: any) => void;
		onDelete?: (material: any) => void;
		onDownload?: () => void;
		onOpenUrl?: () => void;
		triggerClass?: string;
	} = $props();
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger>
		{#snippet child({ props })}
			<Button variant="ghost" size="icon" class="h-8 w-8 {triggerClass}" {...props}>
				<MoreVerticalIcon class="h-4 w-4" />
			</Button>
		{/snippet}
	</DropdownMenu.Trigger>
	<DropdownMenu.Content align="end" class="w-48">
		{#if material.filePath && onDownload}
			<DropdownMenu.Item onclick={onDownload}>
				<DownloadIcon class="h-4 w-4 mr-2" />
				Descarcă
			</DropdownMenu.Item>
		{/if}
		{#if material.externalUrl && onOpenUrl}
			<DropdownMenu.Item onclick={onOpenUrl}>
				<ExternalLinkIcon class="h-4 w-4 mr-2" />
				Deschide URL
			</DropdownMenu.Item>
		{/if}
		{#if (material.filePath || material.externalUrl) && canModify}
			<DropdownMenu.Separator />
		{/if}
		{#if canModify && onEdit}
			<DropdownMenu.Item onclick={() => onEdit?.(material)}>
				<PencilIcon class="h-4 w-4 mr-2" />
				Editează
			</DropdownMenu.Item>
		{/if}
		{#if canModify && onDelete}
			<DropdownMenu.Item class="text-destructive focus:text-destructive" onclick={() => onDelete?.(material)}>
				<Trash2Icon class="h-4 w-4 mr-2" />
				Șterge
			</DropdownMenu.Item>
		{/if}
	</DropdownMenu.Content>
</DropdownMenu.Root>
