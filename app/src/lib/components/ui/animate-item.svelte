<script lang="ts">
	import { onMount } from 'svelte';
	import type { TransitionConfig } from 'svelte/transition';

	let { 
		delay = 0,
		duration = 600,
		y = 30,
		opacity = 0,
		class: className = '',
		index = 0,
		children
	}: {
		delay?: number;
		duration?: number;
		y?: number;
		opacity?: number;
		class?: string;
		index?: number;
		children?: import('svelte').Snippet;
	} = $props();

	let element: HTMLElement;
	let visible = $state(false);

	// Stagger delay based on index - more refined timing
	const staggerDelay = $derived(delay + (index * 80));

	// Custom transition that combines fade and fly with professional easing
	function fadeFly(node: Element, { delay = 0, duration = 600, y = 30, opacity = 0 }: { delay?: number; duration?: number; y?: number; opacity?: number }): TransitionConfig {
		const style = getComputedStyle(node);
		const opacity_value = +style.opacity;
		const transform_value = style.transform === 'none' ? '' : style.transform;

		return {
			delay,
			duration,
			css: (t) => {
				// Professional easing curve: cubic-bezier(0.4, 0, 0.2, 1) - Material Design standard
				// This creates a smooth, polished animation similar to navitech.systems
				// Simplified cubic ease-out for better performance
				const eased = 1 - Math.pow(1 - t, 3);
				const finalOpacity = opacity + (opacity_value - opacity) * eased;
				const translateY = (1 - eased) * y;
				return `
					opacity: ${finalOpacity};
					transform: ${transform_value} translateY(${translateY}px);
					will-change: opacity, transform;
				`;
			}
		};
	}

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
				rootMargin: '0px 0px -50px 0px'
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

<div
	bind:this={element}
	class={className}
>
	{#if visible}
		<div
			transition:fadeFly={{ delay: staggerDelay, duration, y, opacity }}
		>
			{#if children}
				{@render children()}
			{/if}
		</div>
	{:else}
		<div style="opacity: {opacity}; transform: translateY({y}px);">
			{#if children}
				{@render children()}
			{/if}
		</div>
	{/if}
</div>

