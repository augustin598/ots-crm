<script lang="ts">
	import SmartphoneIcon from '@lucide/svelte/icons/smartphone';
	import type { PsiStrategy } from '$lib/logic/pagespeed';

	let { strategy, size = 13 }: { strategy: PsiStrategy; size?: number } = $props();
</script>

{#if strategy === 'mobile'}
	<SmartphoneIcon {size} />
{:else}
	<!-- monitor cu picior, ca în design -->
	<svg
		width={size}
		height={size}
		viewBox="0 0 24 24"
		fill="none"
		stroke="currentColor"
		stroke-width="2"
		stroke-linecap="round"
		stroke-linejoin="round"
		aria-hidden="true"
	>
		<rect x="2" y="3" width="20" height="14" rx="2" />
		<line x1="8" y1="21" x2="16" y2="21" />
		<line x1="12" y1="17" x2="12" y2="21" />
	</svg>
{/if}
