<script lang="ts">
	import IconGoogleAds from '$lib/components/marketing/icon-google-ads.svelte';
	import IconFacebook from '$lib/components/marketing/icon-facebook.svelte';
	import IconTiktok from '$lib/components/marketing/icon-tiktok.svelte';
	import IconGmail from '$lib/components/marketing/icon-gmail.svelte';
	import SearchIcon from '@lucide/svelte/icons/search';
	import WrenchIcon from '@lucide/svelte/icons/wrench';
	import TrendingUpIcon from '@lucide/svelte/icons/trending-up';
	import ZapIcon from '@lucide/svelte/icons/zap';
	import SettingsIcon from '@lucide/svelte/icons/settings';
	import LayoutIcon from '@lucide/svelte/icons/layout';
	import CodeIcon from '@lucide/svelte/icons/code';
	import ShoppingBagIcon from '@lucide/svelte/icons/shopping-bag';
	import MousePointerClickIcon from '@lucide/svelte/icons/mouse-pointer-click';
	import SmartphoneIcon from '@lucide/svelte/icons/smartphone';

	type Props = {
		slug: string;
		class?: string;
	};

	let { slug, class: className = 'h-6 w-6' }: Props = $props();
</script>

{#if slug === 'google-ads' || slug === 'google-ads-setup'}
	<IconGoogleAds class={className} />
{:else if slug === 'meta-ads'}
	<IconFacebook class={className} />
{:else if slug === 'tiktok-ads'}
	<IconTiktok class={className} />
{:else if slug === 'email-marketing'}
	<IconGmail class={className} />
{:else if slug === 'seo'}
	<SearchIcon class={className} />
{:else if slug === 'wordpress-maintenance'}
	<WrenchIcon class={className} />
{:else if slug === 'cro'}
	<TrendingUpIcon class={className} />
{:else if slug === 'marketing-automation'}
	<ZapIcon class={className} />
{:else if slug === 'website-dev'}
	<LayoutIcon class={className} />
{:else if slug === 'website-custom'}
	<CodeIcon class={className} />
{:else if slug === 'woocommerce-dev'}
	<ShoppingBagIcon class={className} />
{:else if slug === 'landing-page-dev'}
	<MousePointerClickIcon class={className} />
{:else if slug === 'mobile-app'}
	<SmartphoneIcon class={className} />
{:else}
	<SettingsIcon class={className} />
{/if}
