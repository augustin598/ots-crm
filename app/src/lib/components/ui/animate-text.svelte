<script lang="ts">
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';

	let { 
		delay = 0,
		duration = 600,
		opacity = 0,
		class: className = ''
	}: {
		delay?: number;
		duration?: number;
		opacity?: number;
		class?: string;
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
			transition:fade={{ duration, delay, start: opacity }}
		>
			<slot />
		</span>
	{:else}
		<span style="opacity: {opacity};">
			<slot />
		</span>
	{/if}
</span>

