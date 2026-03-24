<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils';

	interface Props {
		onclick: () => void;
		active?: boolean;
		disabled?: boolean;
		title?: string;
		children: Snippet;
		class?: string;
	}

	let { onclick, active = false, disabled = false, title, children, class: className }: Props = $props();
</script>

<button
	type="button"
	{onclick}
	{disabled}
	{title}
	class={cn(
		'inline-flex h-7 w-7 items-center justify-center rounded text-sm transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50',
		active && 'bg-accent text-accent-foreground',
		className
	)}
>
	{@render children()}
</button>
