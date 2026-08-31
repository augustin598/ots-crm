<script lang="ts">
	import IconTiktok from '$lib/components/marketing/icon-tiktok.svelte';
	import IconGoogleAds from '$lib/components/marketing/icon-google-ads.svelte';
	import IconFacebook from '$lib/components/marketing/icon-facebook.svelte';
	import type { PlatformId } from '$lib/logic/interviuri-kpi';

	let { id, class: className = 'size-4' }: { id: PlatformId; class?: string } = $props();
</script>

{#if id === 'tiktok'}
	<IconTiktok class={className} />
{:else if id === 'google'}
	<IconGoogleAds class={className} />
{:else}
	<IconFacebook class={className} />
{/if}
