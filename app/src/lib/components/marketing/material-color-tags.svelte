<script lang="ts">
	import { parseColorTags, getTagColor, type ColorTag } from './tag-colors';

	let {
		tags,
		onUpdate
	}: {
		tags: string | null;
		onUpdate?: (tags: ColorTag[]) => void;
	} = $props();

	const colorTags = $derived(parseColorTags(tags));
</script>

{#if colorTags.length > 0}
	<div class="flex flex-wrap items-center gap-1">
		{#each colorTags as tag}
			{@const color = getTagColor(tag.color)}
			{#if color}
				<span
					class="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full {color.bg} {color.text} leading-tight"
				>
					<span class="h-2 w-2 rounded-full {color.dot} shrink-0"></span>
					<span class="max-w-[80px] truncate">{tag.label || color.label}</span>
				</span>
			{/if}
		{/each}
	</div>
{:else}
	<span class="text-xs text-muted-foreground">--</span>
{/if}
