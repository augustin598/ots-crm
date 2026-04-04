<script lang="ts">
	import { onMount } from 'svelte';
	import type { Snippet } from 'svelte';
	import { fade } from 'svelte/transition';

	let {
		delay = 0,
		duration = 600,
		opacity = 0,
		class: className = '',
		children
	}: {
		delay?: number;
		duration?: number;
		opacity?: number;
		class?: string;
		children: Snippet;
	} = $props();

	let element: HTMLElement;
	let visible = $state(false);

	onMount(() => {
		const observer = new IntersectionObserver(
			(entries) => {
				entries.forEach((entry) => {
					if (entry.isIntersecting) {
						visible = true;
						observer.disconnect();
					}
				});
			},
			{
				threshold: 0.1,
				rootMargin: '0px 0px -30px 0px'
			}
		);

		if (element) {
			observer.observe(element);
		}

		return () => {
			observer.disconnect();
		};
	});
</script>

<span
	bind:this={element}
	class={className}
>
	{#if visible}
		<span
			transition:fade={{ duration, delay }}
		>
			{@render children()}
		</span>
	{:else}
		<span style="opacity: {opacity};">
			{@render children()}
		</span>
	{/if}
</span>

