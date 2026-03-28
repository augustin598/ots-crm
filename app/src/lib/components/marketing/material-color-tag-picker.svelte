<script lang="ts">
	import { TAG_COLORS, type ColorTag, getTagColor } from './tag-colors';
	import XIcon from '@lucide/svelte/icons/x';
	import * as Popover from '$lib/components/ui/popover';
	import { Button } from '$lib/components/ui/button';
	import TagIcon from '@lucide/svelte/icons/tag';

	let {
		value = [],
		onChange
	}: {
		value: ColorTag[];
		onChange: (tags: ColorTag[]) => void;
	} = $props();

	let open = $state(false);

	function addColor(colorId: string) {
		if (value.some((t) => t.color === colorId)) return;
		const meta = getTagColor(colorId);
		onChange([...value, { color: colorId as ColorTag['color'], label: meta?.label || '' }]);
		open = false;
	}

	function removeTag(index: number) {
		onChange(value.filter((_, i) => i !== index));
	}

	function updateLabel(index: number, label: string) {
		const updated = value.map((t, i) => (i === index ? { ...t, label } : t));
		onChange(updated);
	}

	const availableColors = $derived(
		TAG_COLORS.filter((c) => !value.some((t) => t.color === c.id))
	);
</script>

<div class="flex flex-wrap items-center gap-1.5">
	{#each value as tag, i}
		{@const color = getTagColor(tag.color)}
		{#if color}
			<div class="inline-flex items-center gap-1 rounded-full {color.bg} pl-1.5 pr-0.5 py-0.5">
				<span class="h-2.5 w-2.5 rounded-full {color.dot} shrink-0"></span>
				<input
					type="text"
					class="bg-transparent border-none outline-none text-xs {color.text} font-medium w-16 min-w-0 placeholder:text-current placeholder:opacity-40"
					value={tag.label}
					placeholder={color.label}
					oninput={(e) => updateLabel(i, (e.target as HTMLInputElement).value)}
					maxlength={30}
				/>
				<button
					type="button"
					class="h-4 w-4 flex items-center justify-center rounded-full hover:bg-black/10 dark:hover:bg-white/10 transition-colors cursor-pointer shrink-0"
					onclick={() => removeTag(i)}
				>
					<XIcon class="h-2.5 w-2.5 {color.text}" />
				</button>
			</div>
		{/if}
	{/each}

	{#if availableColors.length > 0}
		<Popover.Root bind:open>
			<Popover.Trigger>
				{#snippet child({ props })}
					<Button {...props} variant="outline" size="sm" type="button" class="h-6 gap-1 text-muted-foreground px-2">
						<TagIcon class="h-3 w-3" />
						<span class="text-[11px]">+</span>
					</Button>
				{/snippet}
			</Popover.Trigger>
			<Popover.Content class="w-40 p-1.5" align="start">
				<div class="space-y-0.5">
					{#each availableColors as color}
						<button
							type="button"
							class="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent transition-colors cursor-pointer text-left"
							onclick={() => addColor(color.id)}
						>
							<span class="h-3 w-3 rounded-full {color.dot} shrink-0"></span>
							<span class="text-sm">{color.label}</span>
						</button>
					{/each}
				</div>
			</Popover.Content>
		</Popover.Root>
	{/if}
</div>
