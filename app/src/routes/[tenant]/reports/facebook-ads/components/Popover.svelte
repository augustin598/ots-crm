<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		width?: number;
		align?: 'left' | 'right';
		trigger: Snippet<[{ open: boolean; toggle: () => void }]>;
		children: Snippet<[() => void]>;
	}
	let { width = 240, align = 'left', trigger, children }: Props = $props();

	let open = $state(false);
	let wrap = $state<HTMLDivElement | null>(null);

	function toggle() {
		open = !open;
	}
	function close() {
		open = false;
	}

	$effect(() => {
		if (!open) return;
		const onDoc = (e: MouseEvent) => {
			if (wrap && !wrap.contains(e.target as Node)) open = false;
		};
		document.addEventListener('mousedown', onDoc);
		return () => document.removeEventListener('mousedown', onDoc);
	});
</script>

<div class="rk-pop-wrap" bind:this={wrap}>
	{@render trigger({ open, toggle })}
	{#if open}
		<div class="rk-pop" style="width:{width}px; {align}:0">
			{@render children(close)}
		</div>
	{/if}
</div>
