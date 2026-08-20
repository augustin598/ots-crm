<!--
	Wrapper peste `PackageComparisonView` care injectează constantele din catalog.
	Folosit de /[tenant]/services (admin) și de portalul clientului.

	Markup-ul propriu-zis trăiește în $lib/components/services/PackageComparisonView.svelte,
	ca să poată fi refolosit și de pagina publică /servicii — care primește aceleași
	date de pe server, nu prin import (vezi comentariul din View).
-->
<script lang="ts">
	import PackageComparisonView from '$lib/components/services/PackageComparisonView.svelte';
	import {
		TIERS,
		TIER_LABELS,
		TIER_COLORS,
		SETUP_DEFAULT_DESCRIPTION,
		HOURLY_RATES,
		WEB_DEV_SLUGS,
		type Category,
		type Tier
	} from '$lib/constants/ots-catalog';

	type Props = {
		open: boolean;
		category: Category | null;
		onRequest?: (tier: Tier) => void;
	};

	let { open = $bindable(), category, onRequest }: Props = $props();

	const isWebDev = $derived(category ? WEB_DEV_SLUGS.has(category.slug) : false);
</script>

<PackageComparisonView
	bind:open
	{category}
	tiers={TIERS}
	tierLabels={TIER_LABELS}
	tierColors={TIER_COLORS}
	setupDefaultDescription={SETUP_DEFAULT_DESCRIPTION}
	hourlyRates={HOURLY_RATES}
	{isWebDev}
	{onRequest}
/>
