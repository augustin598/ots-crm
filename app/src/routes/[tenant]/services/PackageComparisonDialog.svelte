<!--
	Wrapper peste `PackageComparisonView` care injectează constantele din catalog și
	tarifele orare din DB (Settings → Tarife orare).
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
		WEB_DEV_SLUGS,
		type Category,
		type Tier
	} from '$lib/constants/ots-catalog';
	import { getHourlyCatalogView } from '$lib/remotes/hourly-rates.remote';

	type Props = {
		open: boolean;
		category: Category | null;
		onRequest?: (tier: Tier) => void;
	};

	let { open = $bindable(), category, onRequest }: Props = $props();

	const isWebDev = $derived(category ? WEB_DEV_SLUGS.has(category.slug) : false);

	// `.current` (nu `await`): dialogul e montat închis pe pagini fără boundary;
	// până sosesc datele, secțiunea de tarife e pur și simplu goală.
	const hourlyView = getHourlyCatalogView();
	const hourlyRates = $derived(hourlyView.current?.hourlyRates ?? []);
	const rateModes = $derived(hourlyView.current?.rateModes ?? []);
</script>

<PackageComparisonView
	bind:open
	{category}
	tiers={TIERS}
	tierLabels={TIER_LABELS}
	tierColors={TIER_COLORS}
	setupDefaultDescription={SETUP_DEFAULT_DESCRIPTION}
	{hourlyRates}
	{rateModes}
	{isWebDev}
	{onRequest}
/>
