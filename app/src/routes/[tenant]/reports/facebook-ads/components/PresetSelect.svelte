<script lang="ts">
	import Popover from './Popover.svelte';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import Check from '@lucide/svelte/icons/check';
	import { COLUMN_PRESETS, getPreset } from '$lib/utils/column-presets';

	let { value, onSelect }: { value: string; onSelect: (key: string) => void } = $props();
</script>

<Popover width={230} align="right">
	{#snippet trigger({ open, toggle })}
		<button class="rk-preset {open ? 'active' : ''}" onclick={toggle}>{getPreset(value).label}<ChevronDown size={13} /></button>
	{/snippet}
	{#snippet children(close)}
		<div class="rk-pop-list">
			{#each COLUMN_PRESETS as p (p.key)}
				<button class="rk-presetitem {p.key === value ? 'active' : ''}" onclick={() => { onSelect(p.key); close(); }}>
					{#if p.key === value}<Check size={13} />{/if}<span>{p.label}</span>
				</button>
			{/each}
		</div>
	{/snippet}
</Popover>
