<script lang="ts">
	import type { LayoutData } from './$types';
	import { hexToOklchHue, isValidHex } from '$lib/theme-utils';

	let { data, children }: { data: LayoutData; children: any } = $props();

	const themeHue = $derived(
		data.tenant?.themeColor && isValidHex(data.tenant.themeColor)
			? hexToOklchHue(data.tenant.themeColor)
			: 245
	);
</script>

<svelte:head>
	{@html `<style>:root{--theme-hue:${themeHue}}</style>`}
</svelte:head>

{@render children()}
