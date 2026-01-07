<script lang="ts">
	import { microanimation } from 'svelte-microanimations';
	import { fadeSlide } from 'svelte-microanimations';

	let { 
		delay = 0,
		duration = 700,
		y = 40,
		opacity = 0,
		class: className = '',
		style: style = '',
		children
	}: {
		delay?: number;
		duration?: number;
		y?: number;
		opacity?: number;
		class?: string;
		style?: string;
		children?: import('svelte').Snippet;
	} = $props();

</script>

<div
	class={className}
	style={style}
	use:microanimation={{  transition: fadeSlide, params: {delay, duration, y, opacity}, threshold: 0.1 }}
>
	{#if children}
		{@render children()}
	{/if}
</div>

